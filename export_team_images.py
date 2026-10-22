"""
Xuat anh PNG theo tung doi (cot Doi) cho moi sheet trong Book1.xlsm.
Can cai Microsoft Excel tren Windows.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Callable

import pymupdf as fitz
import pythoncom
import pywintypes
import win32com.client as win32
from PIL import Image, ImageGrab

RPC_E_CALL_REJECTED = -2147418111

# Excel constants
XL_CELL_TYPE_VISIBLE = 12
XL_TYPE_PDF = 0
XL_LANDSCAPE = 2
XL_PICTURE = -4147
XL_SCREEN = 1
XL_PRINTER = 2

ROOT = Path(__file__).resolve().parent


def quit_excel_safe(excel, wb=None) -> None:
    """Dong workbook + thoat Excel, tranh EXCEL.EXE treo nen."""
    if wb is not None:
        try:
            wb.Close(SaveChanges=False)
        except Exception:
            pass
    if excel is None:
        return
    try:
        excel.Interactive = True
        excel.EnableEvents = True
        excel.DisplayAlerts = False
    except Exception:
        pass
    try:
        excel.Quit()
    except Exception:
        pass
    time.sleep(0.5)
    try:
        import gc

        del wb
        del excel
        gc.collect()
    except Exception:
        pass


def com_retry(fn, *, retries: int = 40, delay: float = 0.35):
    """Excel COM hay tra ve 'Call was rejected by callee' khi dang ban."""
    last: Exception | None = None
    for _ in range(retries):
        try:
            return fn()
        except pywintypes.com_error as exc:
            last = exc
            if exc.hresult == RPC_E_CALL_REJECTED:
                pythoncom.PumpWaitingMessages()
                time.sleep(delay)
                continue
            raise
    if last is not None:
        raise last
    raise RuntimeError("com_retry failed")


def pick_workbook_dialog() -> Path | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askopenfilename(
        title="Chọn file Excel (.xlsm / .xlsx)",
        filetypes=[
            ("Excel có macro", "*.xlsm"),
            ("Excel", "*.xlsx"),
            ("Tất cả", "*.*"),
        ],
    )
    root.destroy()
    if not path:
        return None
    return Path(path)


def resolve_workbook(cfg: dict, args) -> Path | None:
    if getattr(args, "file", None):
        p = Path(args.file).expanduser().resolve()
        return p if p.is_file() else None
    if getattr(args, "pick", False):
        return pick_workbook_dialog()
    p = (ROOT / cfg["workbook"]).resolve()
    return p if p.is_file() else None


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip() or "unknown"


def column_indices_from_names(ws, header_row: int, column_names: list[str]) -> list[int]:
    return sorted({find_column(ws, header_row, name) for name in column_names})


def column_bounds_from_names(
    ws, header_row: int, column_names: list[str]
) -> tuple[int, int]:
    indices = column_indices_from_names(ws, header_row, column_names)
    return min(indices), max(indices)


def hide_columns_except(ws, keep_cols: set[int], last_col_full: int) -> list[int]:
    """An cot khong nam trong danh sach (giong chup tay tren Excel)."""
    hidden: list[int] = []
    for col_idx in range(1, last_col_full + 1):
        if col_idx in keep_cols:
            continue
        col = ws.Columns(col_idx)
        if not col.Hidden:
            hidden.append(col_idx)
            col.Hidden = True
    return hidden


def find_column(ws, header_row: int, column_name: str) -> int:
    used = ws.UsedRange
    last_col = used.Column + used.Columns.Count - 1
    for col in range(1, last_col + 1):
        val = ws.Cells(header_row, col).Value
        if val is not None and str(val).strip() == column_name:
            return col
    raise ValueError(f"Khong tim thay cot '{column_name}' o hang {header_row}")


def collect_teams(ws, header_row: int, doi_col: int, skip: set[str]) -> list[str]:
    used = ws.UsedRange
    last_row = used.Row + used.Rows.Count - 1
    teams: set[str] = set()
    for row in range(header_row + 1, last_row + 1):
        val = ws.Cells(row, doi_col).Value
        if val is None:
            continue
        name = str(val).strip()
        if not name or name in skip:
            continue
        teams.add(name)
    return sorted(teams)


def reset_filter(ws) -> None:
    if ws.AutoFilterMode:
        try:
            ws.ShowAllData()
        except Exception:
            pass
        ws.AutoFilterMode = False


XL_PASTE_COLUMN_WIDTHS = 8


def _sync_temp_column_widths(temp_ws, src_ws, col_indices: list[int]) -> None:
    """Gan do rong cot sheet tam = dung cot tren file Excel goc."""
    for j, src_idx in enumerate(sorted(col_indices), start=1):
        try:
            temp_ws.Columns(j).ColumnWidth = src_ws.Columns(src_idx).ColumnWidth
        except Exception:
            continue


def _cell_has_display(cell) -> bool:
    try:
        text = str(cell.Text).strip()
    except Exception:
        text = ""
    if text and text not in ("None", "#N/A"):
        return True
    v = cell.Value2
    if v is None:
        return False
    return str(v).strip() != ""


def _temp_sheet_has_values(temp, *, min_filled: int = 3) -> bool:
    used = temp.UsedRange
    if used is None or used.Rows.Count < 1:
        return False
    filled = 0
    max_r = min(int(used.Rows.Count), 120)
    max_c = min(int(used.Columns.Count), 40)
    for r in range(1, max_r + 1):
        for c in range(1, max_c + 1):
            if _cell_has_display(temp.Cells(r, c)):
                filled += 1
                if filled >= min_filled:
                    return True
    return False


def copy_visible_to_temp(
    wb, ws, rng, *, col_indices: list[int] | None = None
) -> object | None:
    """Sao chep vung loc (AutoFilter) sang sheet tam; giu do rong cot tu sheet goc."""
    app = wb.Application
    temp = wb.Worksheets.Add(After=ws)
    try:
        app.CalculateFull()
        ws.Activate()
        app.CutCopyMode = False
        com_retry(lambda: rng.Select(), retries=15)
        com_retry(lambda: app.Selection.Copy(), retries=20)
        time.sleep(0.25)
        dest = temp.Range("A1")
        dest.PasteSpecial(Paste=-4104)  # xlPasteAll
        try:
            dest.PasteSpecial(Paste=XL_PASTE_COLUMN_WIDTHS)
        except Exception:
            pass
        if col_indices:
            _sync_temp_column_widths(temp, ws, col_indices)
        app.CutCopyMode = False
        used = temp.UsedRange
        if used is None or used.Rows.Count < 1:
            temp.Delete()
            return None
        if used.Rows.Count > 800 or used.Columns.Count > 40:
            temp.Delete()
            return None
        if not _temp_sheet_has_values(temp):
            temp.Delete()
            return None
        return temp
    except Exception:
        temp.Delete()
        return None
    finally:
        app.CutCopyMode = False


def _clamp_pdf_dpi(rng, dpi: int, *, max_width_px: int = 6500) -> int:
    try:
        w_pt = float(rng.Width)
    except Exception:
        return dpi
    if w_pt <= 0:
        return dpi
    est_w = w_pt * dpi / 72.0
    if est_w <= max_width_px:
        return dpi
    return max(96, int(dpi * max_width_px / est_w))


def export_sheet_pdf_to_png(
    ws, out_path: Path, dpi: int = 120, print_rng=None, one_page: bool = True
) -> bool:
    """In vung chon ra PDF (1 trang) roi chuyen PNG — gan giong chup man hinh Excel."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path = out_path.with_suffix(".pdf")
    rng = print_rng or ws.UsedRange
    dpi = _clamp_pdf_dpi(rng, dpi)

    ps = ws.PageSetup
    ps.Zoom = False
    ps.FitToPagesWide = 1
    ps.FitToPagesTall = 1 if one_page else False
    ps.Orientation = XL_LANDSCAPE
    ps.LeftMargin = 0
    ps.RightMargin = 0
    ps.TopMargin = 0
    ps.BottomMargin = 0
    ps.PrintArea = rng.Address

    ws.ExportAsFixedFormat(
        Type=XL_TYPE_PDF,
        Filename=str(pdf_path.resolve()),
        Quality=0,
        IncludeDocProperties=False,
        IgnorePrintAreas=False,
        OpenAfterPublish=False,
    )

    if not pdf_path.is_file():
        return False

    doc = fitz.open(pdf_path)
    try:
        if doc.page_count == 0:
            return False
        scale = dpi / 72.0
        pages: list[Image.Image] = []
        width = 0
        total_h = 0
        max_pixels = 89_000_000
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
            if pix.width * pix.height > max_pixels:
                shrink = (max_pixels / (pix.width * pix.height)) ** 0.5
                scale = max(0.35, scale * shrink * 0.98)
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
            if pix.width * pix.height > max_pixels:
                return False
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            pages.append(img)
            width = max(width, img.width)
            total_h += img.height

        combined = Image.new("RGB", (width, total_h), "white")
        y = 0
        for img in pages:
            combined.paste(img, (0, y))
            y += img.height
        combined.save(out_path, "PNG")
    finally:
        doc.close()
        try:
            pdf_path.unlink(missing_ok=True)
        except OSError:
            pass

    return out_path.is_file() and out_path.stat().st_size > 0


def _row_content_ratio(img: Image.Image, y: int, white_threshold: int) -> float:
    w, _ = img.size
    pixels = img.load()
    dark = 0
    for x in range(w):
        r, g, b = pixels[x, y][:3]
        if r < white_threshold or g < white_threshold or b < white_threshold:
            dark += 1
    return dark / max(w, 1)


def crop_white_margins_image(
    img: Image.Image,
    *,
    white_threshold: int = 248,
    padding: int = 2,
    min_row_ratio: float = 0.0015,
) -> Image.Image:
    """Cat vien trang (ke ca vung trang duoi bang sau khi CopyPicture)."""
    img = img.convert("RGB")
    w, h = img.size
    top = 0
    for y in range(h):
        if _row_content_ratio(img, y, white_threshold) >= min_row_ratio:
            top = y
            break
    bottom = h - 1
    for y in range(h - 1, -1, -1):
        if _row_content_ratio(img, y, white_threshold) >= min_row_ratio:
            bottom = y
            break
    left = 0
    right = w - 1
    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p < white_threshold else 0, mode="L")
    bbox = mask.getbbox()
    if bbox:
        left, _, right, _ = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(w - 1, right + padding)
    bottom = min(h - 1, bottom + padding)
    if right <= left or bottom <= top:
        return img
    return img.crop((left, top, right + 1, bottom + 1))


def normalize_png_target_width(path: Path, target_width: int) -> None:
    """Chi phong to neu qua hep (0 = giu nguyen pixel, tranh co cot)."""
    if target_width <= 0 or not path.is_file():
        return
    with Image.open(path) as im:
        w, h = im.size
        if w <= 0 or w >= target_width:
            return
        nh = max(1, int(round(h * target_width / w)))
        im.resize((target_width, nh), Image.Resampling.LANCZOS).save(path, "PNG")


def _ensure_rgb_png(path: Path) -> None:
    if not path.is_file():
        return
    try:
        with Image.open(path) as im:
            if im.mode == "RGB":
                return
            im.convert("RGB").save(path, "PNG")
    except OSError:
        pass


def crop_png_white_margins(
    path: Path,
    *,
    white_threshold: int = 248,
    padding: int = 2,
) -> None:
    if not path.is_file():
        return
    with Image.open(path) as im:
        cropped = crop_white_margins_image(
            im, white_threshold=white_threshold, padding=padding
        )
        if cropped.size != im.size:
            cropped.save(path, "PNG")


def png_looks_blank(path: Path, mean_threshold: float = 251.0) -> bool:
    """Phat hien PNG gan nhu trang (chart paste loi: nen trang + vai pixel xam)."""
    try:
        img = Image.open(path).convert("L")
        pixels = list(img.getdata())
        if not pixels:
            return True
        n = len(pixels)
        dark = sum(1 for p in pixels if p < 200)
        mid = sum(1 for p in pixels if p < 235)
        min_dark = max(8000, int(n * 0.004))
        min_mid = max(25000, int(n * 0.012))
        if dark >= min_dark or mid >= min_mid:
            return False
        mean = sum(pixels) / n
        return mean > mean_threshold
    except OSError:
        return True


def _visible_range(rng):
    try:
        return rng.SpecialCells(XL_CELL_TYPE_VISIBLE)
    except Exception:
        return rng


def _capture_range(rng, *, contiguous: bool):
    """Sheet tam da gom khoi lien tuc — khong dung SpecialCells (de CopyPicture loi)."""
    if contiguous:
        return rng
    return _visible_range(rng)


def export_sheet_png_chart(
    ws,
    out_path: Path,
    rng,
    *,
    appearance: int = XL_PRINTER,
    scale: float = 2.0,
) -> bool:
    """Xuat dung vung da loc (giu mau cot nhu Excel)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if rng is None:
        return False

    chart_obj = None
    app = ws.Parent.Application
    was_visible = bool(app.Visible)
    try:
        vis = rng
        app.Visible = True
        app.ScreenUpdating = True
        ws.Activate()
        app.CutCopyMode = False
        com_retry(lambda: vis.Select(), retries=15)
        time.sleep(0.2)

        w_pt = max(50, min(9000, int(vis.Width) + 4))
        h_pt = max(50, min(9000, int(vis.Height) + 4))
        chart_obj = ws.ChartObjects().Add(0, 0, w_pt, h_pt)
        chart_obj.Activate()
        com_retry(
            lambda: vis.CopyPicture(Appearance=appearance, Format=XL_PICTURE),
            retries=20,
        )
        time.sleep(0.55)
        chart_obj.Chart.Paste()
        time.sleep(0.25)
        chart_obj.Chart.Export(str(out_path.resolve()), "PNG")
        _ensure_rgb_png(out_path)
        ok = out_path.is_file() and out_path.stat().st_size > 0
        if ok and png_looks_blank(out_path):
            ok = False
            try:
                out_path.unlink(missing_ok=True)
            except OSError:
                pass
        return ok
    except pywintypes.com_error:
        return False
    except Exception:
        return False
    finally:
        if chart_obj is not None:
            try:
                chart_obj.Delete()
            except Exception:
                pass
        app.CutCopyMode = False
        app.Visible = was_visible


def export_sheet_png_clipboard(ws, out_path: Path, rng, *, appearance: int = XL_PRINTER) -> bool:
    app = ws.Parent.Application
    was_visible = bool(app.Visible)
    try:
        vis = rng
        app.Visible = True
        ws.Activate()
        app.CutCopyMode = False
        com_retry(lambda: vis.Select(), retries=15)
        com_retry(
            lambda: vis.CopyPicture(Appearance=appearance, Format=XL_PICTURE),
            retries=20,
        )
        time.sleep(0.55)
        img = ImageGrab.grabclipboard()
        if img is None:
            return False
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        img.save(out_path, "PNG")
        return out_path.is_file() and not png_looks_blank(out_path)
    except pywintypes.com_error:
        return False
    except Exception:
        return False
    finally:
        app.CutCopyMode = False
        app.Visible = was_visible


def export_view_as_doi1(
    ws,
    view_rng,
    out_path: Path,
    *,
    pdf_dpi: int,
    crop_white: bool = True,
    crop_white_threshold: int = 248,
    crop_padding: int = 2,
    target_width: int = 1600,
    export_scale: float = 2.0,
    contiguous_block: bool = False,
    export_col_count: int | None = None,
) -> bool:
    """Chup vung da loc tren sheet goc (mau + layout gan xlsc/tkm.jpeg)."""
    app = ws.Parent.Application
    app.Visible = True
    app.ScreenUpdating = True

    if out_path.is_file():
        try:
            out_path.unlink()
        except OSError:
            pass

    del contiguous_block  # AutoFilter + an cot: in PDF dung view_rng, khong SpecialCells
    cap_rng = view_rng
    try:
        rows = int(cap_rng.Rows.Count)
        cols = int(export_col_count or cap_rng.Columns.Count)
    except Exception:
        rows, cols = 9999, 9999

    ok = False
    if cols <= 45:
        dpi_plan = (pdf_dpi, 150, 120, 96)
        if rows > 350:
            dpi_plan = (120, 96, 86, 72)
        for try_dpi in dpi_plan:
            try:
                if export_sheet_pdf_to_png(
                    ws, out_path, dpi=try_dpi, print_rng=cap_rng, one_page=True
                ) and not png_looks_blank(out_path):
                    ok = True
                    break
            except Exception:
                pass
            try:
                out_path.unlink(missing_ok=True)
            except OSError:
                pass

    if not ok:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    _ensure_rgb_png(out_path)
    if png_looks_blank(out_path):
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    if crop_white:
        crop_png_white_margins(
            out_path,
            white_threshold=crop_white_threshold,
            padding=crop_padding,
        )
    normalize_png_target_width(out_path, target_width)
    return out_path.is_file() and not png_looks_blank(out_path)


def _hide_marker_row_xlsc(ws) -> bool:
    if ws.Name != "XLSC_TON":
        return False
    if ws.Rows(3).Hidden:
        return False
    probe = ws.Cells(3, 3).Value
    if probe is not None and str(probe).strip().upper() == "X":
        ws.Rows(3).Hidden = True
        return True
    return False


def export_team_sheet(
    wb,
    ws,
    team: str,
    header_row: int,
    doi_col: int,
    out_path: Path,
    *,
    min_col: int,
    max_col: int,
    capture_mode: str = "doi1",
    pdf_dpi: int = 120,
    crop_white: bool = True,
    crop_white_threshold: int = 248,
    crop_padding: int = 2,
    target_width: int = 1600,
    export_scale: float = 2.0,
    keep_col_indices: set[int] | None = None,
) -> bool:
    del capture_mode  # giu API, luon xuat kieu doi1
    used = ws.UsedRange
    last_row = used.Row + used.Rows.Count - 1
    last_col_full = used.Column + used.Columns.Count - 1

    hidden_cols: list[int] = []
    marker_hidden = False

    try:
        marker_hidden = _hide_marker_row_xlsc(ws)

        reset_filter(ws)
        view_rng = ws.Range(
            ws.Cells(header_row, min_col), ws.Cells(last_row, max_col)
        )
        criteria = team if team.startswith("=") else f"={team}"
        filter_field = doi_col - min_col + 1
        view_rng.AutoFilter(Field=filter_field, Criteria1=criteria)

        if keep_col_indices:
            hidden_cols.extend(
                hide_columns_except(ws, keep_col_indices, last_col_full)
            )
        else:
            for col_idx in range(1, last_col_full + 1):
                if col_idx < min_col or col_idx > max_col:
                    col = ws.Columns(col_idx)
                    if not col.Hidden:
                        hidden_cols.append(col_idx)
                        col.Hidden = True

        wb.Application.CalculateFull()
        wb.Application.CutCopyMode = False
        n_export_cols = (
            len(keep_col_indices) if keep_col_indices else (max_col - min_col + 1)
        )
        return export_view_as_doi1(
            ws,
            view_rng,
            out_path,
            pdf_dpi=pdf_dpi,
            crop_white=crop_white,
            crop_white_threshold=crop_white_threshold,
            crop_padding=crop_padding,
            target_width=target_width,
            export_scale=export_scale,
            contiguous_block=False,
            export_col_count=n_export_cols,
        )
    finally:
        reset_filter(ws)
        for col_idx in hidden_cols:
            ws.Columns(col_idx).Hidden = False
        if marker_hidden:
            ws.Rows(3).Hidden = False


def run_export(
    wb_path: Path,
    *,
    team_filter: list[str] | None = None,
    run_date: str | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> tuple[Path, list[tuple[str, str, bool, str]]]:
    """Xuat anh; tra ve (thu muc output, danh sach ket qua)."""
    pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
    try:
        return _run_export_impl(
            wb_path,
            team_filter=team_filter,
            run_date=run_date,
            on_progress=on_progress,
        )
    finally:
        pythoncom.CoUninitialize()


def _run_export_impl(
    wb_path: Path,
    *,
    team_filter: list[str] | None = None,
    run_date: str | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> tuple[Path, list[tuple[str, str, bool, str]]]:
    cfg = load_json(ROOT / "config.json")
    header_row = int(cfg.get("header_row", 2))
    filter_col = cfg.get("filter_column", "Đội")
    skip = set(cfg.get("skip_teams", []))
    visible = bool(cfg.get("excel_visible", False))
    pdf_dpi = int(cfg.get("pdf_dpi", 120))
    capture_mode = str(cfg.get("capture_mode", "screen"))
    crop_white = bool(cfg.get("crop_white_margins", True))
    crop_white_threshold = int(cfg.get("crop_white_threshold", 248))
    crop_padding = int(cfg.get("crop_padding", 2))
    export_target_width = int(cfg.get("export_target_width", 1600))
    export_scale = float(cfg.get("export_scale", 2.2))

    run_day = run_date or date.today().isoformat()
    out_root = ROOT / cfg.get("output_dir", "output") / run_day

    excel = None
    wb = None
    temp_copy: Path | None = None
    summary: list[tuple[str, str, bool, str]] = []

    try:
        fd, temp_name = tempfile.mkstemp(
            prefix="tool_excel_", suffix=wb_path.suffix or ".xlsm"
        )
        os.close(fd)
        temp_copy = Path(temp_name)
        shutil.copy2(wb_path, temp_copy)
        if on_progress:
            on_progress(
                "Mo ban copy tam (ban co the giu Excel/file khac dang mo; "
                "neu vua sua file hay Save truoc khi xuat)."
            )

        excel = com_retry(lambda: win32.DispatchEx("Excel.Application"))
        excel.DisplayAlerts = False
        excel.Visible = visible
        excel.ScreenUpdating = True
        excel.EnableEvents = False
        excel.AskToUpdateLinks = False
        open_path = str(temp_copy.resolve())
        wb = com_retry(
            lambda: excel.Workbooks.Open(open_path, ReadOnly=False, UpdateLinks=0)
        )
        all_teams: set[str] = set()
        sheet_meta = []

        for sh in cfg["sheets"]:
            ws = wb.Worksheets(sh["name"])
            doi_col = find_column(ws, header_row, filter_col)
            teams = collect_teams(ws, header_row, doi_col, skip)
            col_names = sh.get("export_columns")
            keep_cols: set[int] | None = None
            if col_names:
                indices = column_indices_from_names(ws, header_row, col_names)
                keep_cols = set(indices)
                min_col, max_col = indices[0], indices[-1]
            else:
                used = ws.UsedRange
                min_col = 1
                max_col = used.Column + used.Columns.Count - 1
            sheet_meta.append((sh, ws, doi_col, teams, min_col, max_col, keep_cols))
            all_teams.update(teams)

        if team_filter is not None:
            selected = set(team_filter)
            all_teams = {t for t in all_teams if t in selected}

        if on_progress:
            on_progress(f"Xuat {len(all_teams)} doi -> {out_root}")

        for team in sorted(all_teams):
            safe = sanitize_filename(team)
            for sh, ws, doi_col, teams, min_col, max_col, keep_cols in sheet_meta:
                if team not in teams:
                    summary.append((team, sh["suffix"], False, "Khong co du lieu"))
                    continue
                out_path = out_root / safe / f"{safe}_{sh['suffix']}.png"
                try:
                    ok = export_team_sheet(
                        wb,
                        ws,
                        team,
                        header_row,
                        doi_col,
                        out_path,
                        min_col=min_col,
                        max_col=max_col,
                        capture_mode=capture_mode,
                        pdf_dpi=pdf_dpi,
                        crop_white=crop_white,
                        crop_white_threshold=crop_white_threshold,
                        crop_padding=crop_padding,
                        target_width=export_target_width,
                        export_scale=export_scale,
                        keep_col_indices=keep_cols,
                    )
                    msg = str(out_path) if ok else "Khong co dong hien thi sau loc"
                    summary.append((team, sh["suffix"], ok, msg))
                    if on_progress:
                        status = "OK" if ok else "SKIP"
                        on_progress(f"  [{status}] {team} / {sh['name']}")
                except Exception as exc:
                    summary.append((team, sh["suffix"], False, str(exc)))
                    if on_progress:
                        on_progress(f"  [ERR] {team} / {sh['name']}: {exc}")

        manifest = {
            "date": run_day,
            "workbook": str(wb_path),
            "workbook_copy": str(temp_copy) if temp_copy else None,
            "teams": sorted(all_teams),
            "results": [
                {"team": t, "sheet": s, "ok": ok, "detail": detail}
                for t, s, ok, detail in summary
            ],
        }
        out_root.mkdir(parents=True, exist_ok=True)
        with (out_root / "manifest.json").open("w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    finally:
        quit_excel_safe(excel, wb)
        if temp_copy is not None:
            try:
                temp_copy.unlink(missing_ok=True)
            except OSError:
                pass

    return out_root, summary


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Xuat anh Excel theo doi")
    parser.add_argument(
        "--team",
        action="append",
        dest="teams",
        help="Chi xuat mot hoac nhieu doi (co the lap lai flag)",
    )
    parser.add_argument(
        "--date",
        dest="run_date",
        help="Thu muc output theo ngay YYYY-MM-DD (mac dinh: hom nay)",
    )
    parser.add_argument(
        "--pick",
        action="store_true",
        help="Mo hop thoai chon file Excel (khong can copy vao thu muc tool)",
    )
    parser.add_argument(
        "--file",
        dest="file",
        help="Duong dan file Excel (uu tien hon config.json)",
    )
    args = parser.parse_args()

    cfg = load_json(ROOT / "config.json")
    wb_path = resolve_workbook(cfg, args)
    if wb_path is None:
        print(
            "Khong co file Excel. Dung --pick de chon file, hoac --file, "
            f"hoac dat file tai {ROOT / cfg['workbook']}",
            file=sys.stderr,
        )
        return 1

    print(f"File nguon: {wb_path}")

    team_filter = list(args.teams) if args.teams else None
    if team_filter is not None and not team_filter:
        print("Khong co doi nao khop --team", file=sys.stderr)
        return 1

    def progress(msg: str) -> None:
        print(msg)

    out_root, summary = run_export(
        wb_path,
        team_filter=team_filter,
        run_date=args.run_date,
        on_progress=progress,
    )
    failed = sum(1 for _, _, ok, _ in summary if not ok)
    print(f"Hoan tat. That bai / bo qua: {failed}/{len(summary)} -> {out_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
