"""
Tool GUI: import Excel, cau hinh nhom WhatsApp theo doi, xuat anh + gui.
"""
from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from typing import Callable
from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from scan_teams import scan_teams_from_workbook
from settings_cache import (
    load_cache,
    merge_teams_from_excel,
    save_cache,
    teams_for_whatsapp,
)

ROOT = Path(__file__).resolve().parent


class TeamRow:
    __slots__ = ("team", "send_var", "group_var", "message_var", "frame")

    def __init__(
        self,
        parent: ttk.Frame,
        team: str,
        group: str,
        message_text: str,
        send: bool,
        on_send_toggle: Callable[[], None] | None = None,
    ) -> None:
        self.team = team
        self.frame = ttk.Frame(parent)
        self.send_var = tk.BooleanVar(value=send)
        ttk.Checkbutton(
            self.frame,
            variable=self.send_var,
            width=3,
            command=on_send_toggle,
        ).grid(row=0, column=0, padx=(0, 4))
        ttk.Label(self.frame, text=team, width=22, anchor="w").grid(
            row=0, column=1, sticky="w"
        )
        self.group_var = tk.StringVar(value=group)
        ttk.Entry(self.frame, textvariable=self.group_var, width=28).grid(
            row=0, column=2, padx=4, sticky="ew"
        )
        self.message_var = tk.StringVar(value=message_text)
        ttk.Entry(self.frame, textvariable=self.message_var, width=28).grid(
            row=0, column=3, padx=4, sticky="ew"
        )
        self.frame.columnconfigure(2, weight=1)
        self.frame.columnconfigure(3, weight=1)

    def grid(self, row: int) -> None:
        self.frame.grid(row=row, column=0, sticky="ew", pady=1)

    def to_dict(self) -> dict:
        msg = self.message_var.get().strip() or self.team
        return {
            "whatsapp_group": self.group_var.get().strip(),
            "message_text": msg,
            "send": self.send_var.get(),
        }


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Tool Excel - Bao cao theo doi / WhatsApp")
        self.geometry("1080x640")
        self.minsize(900, 520)

        self.cache = load_cache()
        self.workbook_var = tk.StringVar(value=self.cache.get("last_workbook", ""))
        self.status_var = tk.StringVar(value="San sang")
        self._log_queue: queue.Queue[str] = queue.Queue()
        self._busy = False
        self._rows: list[TeamRow] = []
        self._select_all_var = tk.BooleanVar(value=True)
        self._updating_select_all = False

        self._build_ui()
        self._restore_teams_ui()
        self.after(200, self._drain_log)

    def _build_ui(self) -> None:
        pad = {"padx": 10, "pady": 6}

        top = ttk.LabelFrame(self, text="File Excel")
        top.pack(fill="x", **pad)

        ttk.Entry(top, textvariable=self.workbook_var).grid(
            row=0, column=0, sticky="ew", padx=8, pady=8
        )
        top.columnconfigure(0, weight=1)
        btns = ttk.Frame(top)
        btns.grid(row=0, column=1, padx=8, pady=8)
        ttk.Button(btns, text="Chon file...", command=self._browse_excel).pack(
            side="left", padx=2
        )
        ttk.Button(btns, text="Dong bo doi tu Excel", command=self._sync_teams).pack(
            side="left", padx=2
        )

        mid = ttk.LabelFrame(
            self,
            text="Cai dat nhom WhatsApp (luu trong settings_cache.json)",
        )
        mid.pack(fill="both", expand=True, **pad)

        header = ttk.Frame(mid)
        header.pack(fill="x", padx=8, pady=(8, 4))
        self._chk_select_all = ttk.Checkbutton(
            header,
            text="Chon tat ca (gui WA)",
            variable=self._select_all_var,
            command=self._apply_select_all,
        )
        self._chk_select_all.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 4))
        ttk.Label(header, text="Ten doi (cot Doi)", width=28, anchor="w").grid(
            row=1, column=1, sticky="w"
        )
        ttk.Label(header, text="Ten nhom WhatsApp Web", anchor="w").grid(
            row=1, column=2, sticky="w", padx=4
        )
        ttk.Label(
            header,
            text="Ten trong tin (XLSC/TKM)",
            anchor="w",
        ).grid(row=1, column=3, sticky="w", padx=4)
        ttk.Label(header, text="Gui", width=4).grid(row=1, column=0)

        canvas = tk.Canvas(mid, highlightthickness=0)
        scroll = ttk.Scrollbar(mid, orient="vertical", command=canvas.yview)
        self._teams_inner = ttk.Frame(canvas)
        self._teams_inner.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.create_window((0, 0), window=self._teams_inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=(0, 8))
        scroll.pack(side="right", fill="y", padx=(0, 8), pady=(0, 8))

        def _on_mousewheel(event: tk.Event) -> None:
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        canvas.bind_all("<MouseWheel>", _on_mousewheel)
        self._teams_canvas = canvas

        action = ttk.Frame(self)
        action.pack(fill="x", **pad)
        self._btn_save = ttk.Button(action, text="Luu cai dat", command=self._save_settings)
        self._btn_save.pack(side="left", padx=4)
        self._btn_export = ttk.Button(
            action, text="Xuat anh", command=lambda: self._run_job("export")
        )
        self._btn_export.pack(side="left", padx=4)
        self._btn_send = ttk.Button(
            action, text="Gui WhatsApp", command=lambda: self._run_job("send")
        )
        self._btn_send.pack(side="left", padx=4)
        self._btn_both = ttk.Button(
            action,
            text="Xuat anh + Gui WhatsApp",
            command=lambda: self._run_job("both"),
        )
        self._btn_both.pack(side="left", padx=4)

        log_frame = ttk.LabelFrame(self, text="Nhat ky")
        log_frame.pack(fill="both", expand=True, **pad)
        self.log_text = tk.Text(log_frame, height=8, wrap="word", state="disabled")
        self.log_text.pack(fill="both", expand=True, padx=8, pady=8)

        ttk.Label(self, textvariable=self.status_var, anchor="w").pack(
            fill="x", padx=12, pady=(0, 8)
        )

    def _log(self, msg: str) -> None:
        self._log_queue.put(msg)

    def _drain_log(self) -> None:
        try:
            while True:
                msg = self._log_queue.get_nowait()
                self.log_text.configure(state="normal")
                self.log_text.insert("end", msg + "\n")
                self.log_text.see("end")
                self.log_text.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(200, self._drain_log)

    def _browse_excel(self) -> None:
        path = filedialog.askopenfilename(
            title="Chon file Excel",
            filetypes=[
                ("Excel", "*.xlsm *.xlsx"),
                ("Tat ca", "*.*"),
            ],
        )
        if path:
            self.workbook_var.set(path)
            self._sync_teams()

    def _workbook_path(self) -> Path | None:
        p = Path(self.workbook_var.get().strip())
        if not p.is_file():
            return None
        return p.resolve()

    def _clear_team_rows(self) -> None:
        for row in self._rows:
            row.frame.destroy()
        self._rows.clear()

    def _sync_select_all_checkbox(self) -> None:
        if not self._rows:
            self._select_all_var.set(False)
            return
        self._updating_select_all = True
        self._select_all_var.set(all(r.send_var.get() for r in self._rows))
        self._updating_select_all = False

    def _apply_select_all(self) -> None:
        if self._updating_select_all:
            return
        value = self._select_all_var.get()
        for row in self._rows:
            row.send_var.set(value)

    def _restore_teams_ui(self) -> None:
        teams = self.cache.get("teams") or {}
        self._clear_team_rows()
        for i, (name, cfg) in enumerate(sorted(teams.items())):
            if not isinstance(cfg, dict):
                cfg = {"whatsapp_group": str(cfg or ""), "send": True}
            msg = (cfg.get("message_text") or name).strip() or name
            row = TeamRow(
                self._teams_inner,
                name,
                cfg.get("whatsapp_group", ""),
                msg,
                bool(cfg.get("send", True)),
                on_send_toggle=self._sync_select_all_checkbox,
            )
            row.grid(i)
            self._rows.append(row)
        self._sync_select_all_checkbox()

    def _collect_teams_dict(self) -> dict[str, dict]:
        return {r.team: r.to_dict() for r in self._rows}

    def _sync_teams(self) -> None:
        wb = self._workbook_path()
        if wb is None:
            messagebox.showwarning(
                "Chua co file",
                "Hay chon file Excel hop le truoc khi dong bo doi.",
            )
            return
        try:
            excel_teams = scan_teams_from_workbook(wb)
        except Exception as exc:
            messagebox.showerror("Loi doc Excel", str(exc))
            return

        merged = merge_teams_from_excel(excel_teams, self.cache)
        self.cache["teams"] = merged
        self.cache["last_workbook"] = str(wb)
        self._restore_teams_ui()
        self.status_var.set(f"Da dong bo {len(excel_teams)} doi tu file Excel")
        self._log(f"Dong bo: {len(excel_teams)} doi tu {wb.name}")

    def _save_settings(self, silent: bool = False) -> bool:
        wb = self.workbook_var.get().strip()
        self.cache["last_workbook"] = wb
        self.cache["teams"] = self._collect_teams_dict()
        try:
            save_cache(self.cache)
        except Exception as exc:
            if not silent:
                messagebox.showerror("Loi luu", str(exc))
            return False
        self.status_var.set("Da luu cai dat (settings_cache.json)")
        if not silent:
            self._log("Da luu cai dat nhom WhatsApp.")
        return True

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        state = "disabled" if busy else "normal"
        for btn in (
            self._btn_save,
            self._btn_export,
            self._btn_send,
            self._btn_both,
        ):
            btn.configure(state=state)

    def _run_job(self, mode: str) -> None:
        if self._busy:
            return
        if not self._save_settings(silent=True):
            messagebox.showerror("Loi", "Khong luu duoc cai dat.")
            return

        wb = self._workbook_path()
        if mode in ("export", "both") and wb is None:
            messagebox.showwarning("File Excel", "Chon file Excel truoc khi xuat anh.")
            return

        teams_cfg = self._collect_teams_dict()
        selected_teams = [r.team for r in self._rows if r.send_var.get()]
        if mode in ("export", "both") and not selected_teams:
            messagebox.showwarning(
                "Chua chon doi",
                "Tick cot 'Gui' it nhat 1 doi can xuat anh / gui.",
            )
            return

        wa_map = teams_for_whatsapp(teams_cfg)
        if mode in ("send", "both") and not wa_map:
            messagebox.showwarning(
                "Chua cau hinh nhom",
                "Bat checkbox 'Gui' va dien ten nhom WhatsApp cho it nhat 1 doi.",
            )
            return

        self._set_busy(True)
        self.status_var.set("Dang chay...")
        threading.Thread(
            target=self._worker,
            args=(mode, wb, selected_teams, wa_map),
            daemon=True,
        ).start()

    def _run_script(self, args: list[str]) -> None:
        """Chay script Python rieng (tranh loi COM tren luong GUI)."""
        cmd = [sys.executable, *args]
        self._log("Lenh: " + " ".join(f'"{a}"' if " " in a else a for a in cmd))
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            self._log(line.rstrip())
        code = proc.wait()
        if code != 0:
            raise RuntimeError(f"Tien trinh ket thuc loi (ma {code}). Xem nhat ky.")

    def _worker(
        self,
        mode: str,
        wb: Path | None,
        selected_teams: list[str],
        wa_map: dict[str, str],
    ) -> None:
        try:
            if mode in ("export", "both"):
                assert wb is not None
                self._log(
                    f"Bat dau xuat anh ({len(selected_teams)} doi): "
                    + ", ".join(selected_teams)
                )
                export_args = [
                    str(ROOT / "export_team_images.py"),
                    "--file",
                    str(wb),
                ]
                for team in selected_teams:
                    export_args.extend(["--team", team])
                self._run_script(export_args)
                run_day = date.today().isoformat()
                self._log(f"Xuat anh xong: {ROOT / 'output' / run_day}")

            if mode in ("send", "both"):
                self._log(
                    f"Bat dau gui WhatsApp ({len(wa_map)} nhom): "
                    + ", ".join(wa_map.keys())
                )
                send_args = [str(ROOT / "send_whatsapp.py")]
                for team in wa_map:
                    send_args.extend(["--team", team])
                self._run_script(send_args)
                self._log("Hoan tat gui WhatsApp.")

            self.after(0, lambda: self.status_var.set("Hoan tat"))
        except Exception as exc:
            self._log(f"LOI: {exc}")
            self.after(0, lambda: self.status_var.set("Co loi - xem nhat ky"))
            self.after(0, lambda: messagebox.showerror("Loi", str(exc)))
        finally:
            self.after(0, lambda: self._set_busy(False))


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
