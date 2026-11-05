"""
Cầu nối local cho web app: lưu settings, nhận ảnh PNG, chạy send_whatsapp.py.
Chạy: py -3 wa_bridge_server.py  (mặc định http://127.0.0.1:8765)
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import zipfile
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
PORT = 8765

from settings_cache import save_cache  # noqa: E402


def _cors(handler: BaseHTTPRequestHandler) -> None:
    """CORS + Private Network Access (HTTPS Vercel → http://127.0.0.1)."""
    origin = handler.headers.get("Origin")
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
    else:
        handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    req_headers = handler.headers.get("Access-Control-Request-Headers")
    if req_headers:
        handler.send_header("Access-Control-Allow-Headers", req_headers)
    else:
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Private-Network", "true")
    handler.send_header("Access-Control-Max-Age", "86400")


def _read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0"))
    return handler.rfile.read(length) if length else b""


def _json_response(handler: BaseHTTPRequestHandler, code: int, payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    _cors(handler)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _sanitize_folder(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip() or "unknown"


def _extract_zip_to_output(zip_bytes: bytes, run_day: str) -> int:
    out_root = ROOT / "output" / run_day
    out_root.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if not name.lower().endswith(".png"):
                continue
            parts = Path(name).parts
            if len(parts) >= 2:
                team_dir = _sanitize_folder(parts[-2])
                fname = parts[-1]
            else:
                team_dir = "export"
                fname = parts[-1]
            dest = out_root / team_dir / fname
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(info))
            count += 1
    return count


def _run_send_whatsapp(teams: list[str] | None, run_day: str) -> tuple[int, str]:
    cmd = [sys.executable, str(ROOT / "send_whatsapp.py"), "--date", run_day]
    if teams:
        for t in teams:
            cmd.extend(["--team", t])
    proc = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[bridge] {self.address_string()} {fmt % args}")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        _cors(self)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "tool-excel-wa-bridge",
                    "platform": sys.platform,
                },
            )
            return
        _json_response(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/settings":
                body = json.loads(_read_body(self).decode("utf-8"))
                if "teams" not in body:
                    raise ValueError("Thiếu teams")
                save_cache(body)
                _json_response(self, 200, {"ok": True})
                return

            if path == "/api/images":
                run_day = date.today().isoformat()
                qs = parse_qs(urlparse(self.path).query)
                if qs.get("date"):
                    run_day = qs["date"][0]
                ctype = self.headers.get("Content-Type", "")
                if "application/zip" in ctype or "octet-stream" in ctype:
                    n = _extract_zip_to_output(_read_body(self), run_day)
                else:
                    raw = _read_body(self)
                    if not raw:
                        raise ValueError("Body rỗng")
                    n = _extract_zip_to_output(raw, run_day)
                _json_response(
                    self,
                    200,
                    {"ok": True, "images": n, "output_dir": str(ROOT / "output" / run_day)},
                )
                return

            if path == "/api/send":
                payload = json.loads(_read_body(self).decode("utf-8"))
                run_day = payload.get("date") or date.today().isoformat()
                teams = payload.get("teams")
                if teams is not None and not isinstance(teams, list):
                    raise ValueError("teams phải là mảng")
                code, log = _run_send_whatsapp(teams, run_day)
                _json_response(
                    self,
                    200 if code == 0 else 500,
                    {"ok": code == 0, "exit_code": code, "log": log},
                )
                return

            _json_response(self, 404, {"ok": False, "error": "not found"})
        except Exception as exc:
            _json_response(self, 400, {"ok": False, "error": str(exc)})


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"WA Bridge: http://127.0.0.1:{PORT}  (Ctrl+C để dừng)")
    print("Dùng với web Vercel: mở site deploy + chạy bridge trên cùng máy Windows.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng bridge.")


if __name__ == "__main__":
    main()
