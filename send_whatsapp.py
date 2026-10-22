"""
Gui anh da xuat len nhom WhatsApp (WhatsApp Web) bang Playwright.
Lan dau chay: quet QR dang nhap; phien luu trong thu muc whatsapp_profile.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from typing import Callable

from settings_cache import load_cache, message_text_for_team, teams_for_whatsapp

ROOT = Path(__file__).resolve().parent
PROFILE_DIR = ROOT / "whatsapp_profile"
WA_URL = "https://web.whatsapp.com"


def find_installed_chrome() -> Path | None:
    """Tim Google Chrome cai tren Windows (khong dung Chromium Playwright)."""
    candidates = [
        Path(os.environ.get("PROGRAMFILES", ""))
        / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", ""))
        / "Google/Chrome/Application/chrome.exe",
        Path.home() / "AppData/Local/Google/Chrome/Application/chrome.exe",
    ]
    for exe in candidates:
        if exe.is_file():
            return exe.resolve()
    return None


def resolve_whatsapp_profile(cfg: dict) -> Path:
    custom = (cfg.get("whatsapp_profile_dir") or "").strip()
    if custom:
        return ROOT / custom
    browser = str(cfg.get("whatsapp_browser", "chrome")).lower()
    if browser == "chrome":
        return ROOT / "whatsapp_profile_chrome"
    return ROOT / "whatsapp_profile"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def wait_for_logged_in(page, timeout_ms: int = 300_000) -> None:
    """Cho den khi da dang nhap (co o tim kiem hoac danh sach chat)."""
    selectors = [
        "#pane-side",
        '[data-testid="chat-list"]',
        'div[contenteditable="true"][data-tab="3"]',
        '[data-icon="search"]',
        'button[aria-label*="Search"]',
        'button[aria-label*="Tìm kiếm"]',
    ]
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for sel in selectors:
            loc = page.locator(sel).first
            if loc.count() > 0:
                try:
                    if loc.is_visible(timeout=1500):
                        return
                except Exception:
                    pass
        if page.locator("canvas").count() > 0:
            print("Quet ma QR tren cua so trinh duyet WhatsApp Web...")
        time.sleep(2)
    raise TimeoutError("Het thoi gian cho dang nhap WhatsApp Web")


def _click_search_icon(page) -> None:
    for sel in (
        'button[aria-label*="Search"]',
        'button[aria-label*="Tìm kiếm"]',
        'button[aria-label*="Tim kiem"]',
        'span[data-icon="search"]',
        '[data-icon="search"]',
        'button:has([data-icon="search"])',
    ):
        btn = page.locator(sel).first
        if btn.count() == 0:
            continue
        try:
            if btn.is_visible(timeout=2000):
                btn.click(timeout=8000)
                time.sleep(0.5)
                return
        except Exception:
            continue


def _focus_search_box(page):
    """Tim o tim kiem (WhatsApp Web doi giao dien thuong xuyen)."""
    _click_search_icon(page)
    candidates = [
        page.locator('[data-testid="chat-list-search"]').first,
        page.locator("#side div[contenteditable='true']").first,
        page.locator('div[role="textbox"][contenteditable="true"]').first,
        page.locator('div[contenteditable="true"][data-tab="3"]').first,
    ]
    try:
        tb = page.get_by_role(
            "textbox",
            name=re.compile(r"Search|Tìm kiếm|Tim kiem|Ask Meta AI", re.I),
        ).first
        candidates.insert(0, tb)
    except Exception:
        pass

    last_err: Exception | None = None
    for loc in candidates:
        if loc.count() == 0:
            continue
        try:
            if not loc.is_visible(timeout=2000):
                continue
            loc.click(timeout=10_000)
            return loc
        except Exception as exc:
            last_err = exc
    if last_err:
        raise last_err
    raise TimeoutError("Khong tim thay o tim kiem WhatsApp Web")


def open_group_chat(page, group_name: str) -> None:
    page.bring_to_front()
    time.sleep(0.3)
    search = _focus_search_box(page)
    page.keyboard.press("Control+A")
    page.keyboard.press("Backspace")
    page.keyboard.type(group_name, delay=35)
    time.sleep(1.8)

    picked = False
    for strategy in (
        lambda: page.locator(f'span[title="{group_name}"]').first,
        lambda: page.locator("#pane-side").get_by_text(group_name, exact=True).first,
        lambda: page.get_by_text(group_name, exact=True).first,
        lambda: page.locator('[data-testid="cell-frame-container"]').filter(
            has_text=group_name
        ).first,
    ):
        loc = strategy()
        if loc.count() == 0:
            continue
        try:
            loc.click(timeout=15_000)
            picked = True
            break
        except Exception:
            continue

    if not picked:
        raise TimeoutError(
            f"Khong tim thay nhom '{group_name}' — kiem tra ten tren WhatsApp Web (100% trung)."
        )
    time.sleep(0.8)


def ensure_playwright_chromium(on_progress: Callable[[str], None] | None = None) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        exe = ""
        try:
            exe = p.chromium.executable_path or ""
        except Exception:
            pass
        if exe and Path(exe).is_file():
            return

    if on_progress:
        on_progress("Chua co Chromium Playwright — dang tai (chi lan dau, ~200MB)...")
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        check=True,
    )


def ensure_playwright_for_whatsapp(
    cfg: dict, on_progress: Callable[[str], None] | None = None
) -> None:
    """Chi cai Chromium Playwright khi config that su can (khong dung Chrome may)."""
    browser = str(cfg.get("whatsapp_browser", "chrome")).lower()
    strict = bool(cfg.get("whatsapp_browser_strict", True))
    if browser == "chrome" and strict:
        if find_installed_chrome() is None:
            raise RuntimeError(
                "Khong tim thay Google Chrome tren may. "
                "Cai Chrome tu google.com/chrome roi chay lai."
            )
        if on_progress:
            on_progress(
                "Dung Google Chrome cai tren may (KHONG dung Chromium Playwright)."
            )
        return
    ensure_playwright_chromium(on_progress)


def _browser_channel_order(pref: str, *, strict: bool) -> list[str | None]:
    p = (pref or "chrome").strip().lower()
    if p == "chrome":
        return ["chrome"] if strict else ["chrome", "msedge", None]
    if p in ("edge", "msedge"):
        return ["msedge"] if strict else ["msedge", "chrome", None]
    if p in ("chromium", "playwright"):
        return [None]
    return ["chrome"] if strict else ["chrome", "msedge", None]


def _launch_opts(profile_dir: Path, headless: bool, *, real_chrome: bool) -> dict:
    opts = dict(
        user_data_dir=str(profile_dir),
        headless=headless,
        locale="vi-VN",
        viewport={"width": 1536, "height": 864},
    )
    if not real_chrome:
        opts["args"] = ["--disable-blink-features=AutomationControlled"]
        opts["ignore_default_args"] = ["--enable-automation"]
    return opts


def launch_whatsapp_context(
    p,
    *,
    headless: bool,
    browser_pref: str = "chrome",
    strict: bool = True,
    profile_dir: Path,
):
    """Mo Chrome/Edge cai tren may; tranh Chromium Playwright neu config strict."""
    pref = (browser_pref or "chrome").strip().lower()
    chrome_exe = find_installed_chrome()
    last_err: Exception | None = None

    for channel in _browser_channel_order(pref, strict=strict):
        real_chrome = channel == "chrome" and chrome_exe is not None
        opts = _launch_opts(profile_dir, headless, real_chrome=real_chrome)
        try:
            if channel is None:
                ctx = p.chromium.launch_persistent_context(**opts)
                return ctx, "chromium-playwright", ""
            if channel == "chrome":
                try:
                    ctx = p.chromium.launch_persistent_context(
                        channel="chrome", **opts
                    )
                    detail = str(chrome_exe or "channel=chrome")
                    return ctx, "google-chrome", detail
                except Exception as exc:
                    last_err = exc
                    if chrome_exe is None:
                        continue
                    ctx = p.chromium.launch_persistent_context(
                        executable_path=str(chrome_exe), **opts
                    )
                    return ctx, "google-chrome", str(chrome_exe)
            ctx = p.chromium.launch_persistent_context(channel=channel, **opts)
            return ctx, channel, f"channel={channel}"
        except Exception as exc:
            last_err = exc
            continue

    if pref == "chrome" and chrome_exe is None:
        raise RuntimeError(
            "Khong tim thay Google Chrome. Cai Chrome hoac doi whatsapp_browser trong config.json."
        )
    if last_err is not None:
        raise last_err
    raise RuntimeError("Khong mo duoc trinh duyet")


def _click_attach(page) -> None:
    for sel in (
        '[data-testid="attach-menu-plus"]',
        'button[aria-label*="Attach"]',
        'button[aria-label*="Đính kèm"]',
        'span[data-icon="plus"]',
        '[data-icon="plus"]',
    ):
        attach_btn = page.locator(sel).first
        if attach_btn.count() == 0:
            continue
        try:
            attach_btn.click(timeout=12_000)
            return
        except Exception:
            continue
    raise TimeoutError("Khong tim thay nut dinh kem (+)")


def _click_attach_menu_item(page, mode: str) -> None:
    """Chon dung loai: anh (Photos) hoac tep (Document) — tranh gui nham sticker."""
    if mode == "document":
        name_patterns = [
            re.compile(r"^Document$|^Tài liệu$|^Tai lieu$", re.I),
            re.compile(r"Document", re.I),
        ]
        extra_selectors = (
            '[data-testid="mi-attach-document"]',
            '[data-icon="attach-document"]',
            'input[accept="*"][type="file"]',
        )
    else:
        name_patterns = [
            re.compile(r"Photos?\s*&\s*[Vv]ideos?", re.I),
            re.compile(r"Ảnh.*video|Anh.*video", re.I),
        ]
        extra_selectors = (
            '[data-testid="mi-attach-media"]',
            '[data-icon="attach-image"]',
            '[data-icon="image"]',
        )

    for pat in name_patterns:
        for getter in (
            lambda p=pat: page.get_by_role("button", name=p).first,
            lambda p=pat: page.get_by_role("menuitem", name=p).first,
            lambda p=pat: page.locator("li").filter(has_text=p).first,
        ):
            loc = getter()
            if loc.count() == 0:
                continue
            try:
                if loc.is_visible(timeout=2000):
                    loc.click(timeout=8000)
                    return
            except Exception:
                continue

    for sel in extra_selectors:
        loc = page.locator(sel).first
        if loc.count() == 0:
            continue
        try:
            loc.click(timeout=8000)
            return
        except Exception:
            continue

    kind = "Tài liệu" if mode == "document" else "Ảnh & video"
    raise TimeoutError(f"Khong tim thay muc dinh kem '{kind}' trong menu (+)")


def _attach_file(page, image_path: Path, mode: str) -> None:
    """Mo menu + -> Anh & video -> chon file (khong dung input sticker)."""
    path_str = str(image_path.resolve())
    _click_attach(page)
    time.sleep(0.55)
    with page.expect_file_chooser(timeout=25_000) as fc_info:
        _click_attach_menu_item(page, mode)
    fc_info.value.set_files(path_str)
    time.sleep(1.5)


def caption_for_image(image_path: Path, message_team: str) -> str:
    """Noi dung kem theo tung anh: Tồn XLSC|TKM + ten doi."""
    label = (message_team or "").strip()
    upper = image_path.name.upper()
    if "_XLSC" in upper:
        return f"Tồn XLSC {label}"
    if "_TKM" in upper:
        return f"Tồn TKM {label}"
    return ""


def _main_panel(page):
    return page.locator("#main").first


_COMPOSE_MESSAGE_LABEL = re.compile(
    r"Soạn tin nhắn|Soan tin nhan|Type a message|Nhập tin nhắn|Nhap tin nhan",
    re.I,
)


def _try_reveal_media_compose(page) -> None:
    """Thu mo o nhap khi dang o man hinh gui anh."""
    for sel in (
        '[data-testid="media-editor"]',
        '[data-testid="media-viewer"]',
        '[data-testid="conversation-compose-box-input"]',
        "#main footer",
    ):
        loc = page.locator(sel).first
        if loc.count() == 0:
            continue
        try:
            if loc.is_visible(timeout=600):
                loc.click(timeout=4000, position={"x": 40, "y": 40})
                time.sleep(0.2)
        except Exception:
            continue
    for label in ("Thêm chú thích", "Them chu thich", "Add a caption"):
        try:
            link = page.get_by_text(label, exact=False).first
            if link.count() > 0 and link.is_visible(timeout=400):
                link.click(timeout=4000)
                time.sleep(0.3)
                return
        except Exception:
            continue


def _log_compose_debug(page, on_progress: Callable[[str], None] | None) -> None:
    if not on_progress:
        return
    try:
        fields = page.evaluate(
            """() => {
            return [...document.querySelectorAll('div[contenteditable="true"]')]
              .map(el => ({
                label: el.getAttribute('aria-label') || '',
                tab: el.getAttribute('data-tab') || '',
                testid: el.closest('[data-testid]')?.getAttribute('data-testid') || '',
                vis: !!(el.offsetWidth || el.offsetHeight),
              }))
              .filter(x => x.vis)
              .slice(0, 12);
          }"""
        )
        on_progress(f"    Debug (contenteditable): {fields}")
    except Exception as exc:
        on_progress(f"    Debug compose loi: {exc}")


def _wait_for_soan_tin_nhan(
    page, timeout_ms: int = 25_000, *, try_reveal: bool = False
) -> bool:
    """Cho o 'Soạn tin nhắn' sau khi dinh kem (timeout ngan, tranh treo)."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if _locate_soan_tin_nhan(page) is not None:
            time.sleep(0.2)
            return True
        if try_reveal:
            _try_reveal_media_compose(page)
        time.sleep(0.3)
    return False


def _type_in_contenteditable(loc, page, text: str) -> None:
    loc.click(timeout=10_000)
    time.sleep(0.15)
    page.keyboard.press("Control+A")
    page.keyboard.press("Backspace")
    page.keyboard.type(text, delay=20)


def _is_search_compose(box) -> bool:
    try:
        aria = (box.get_attribute("aria-label") or "").lower()
        tab = box.get_attribute("data-tab") or ""
        if tab == "3":
            return True
        if "tìm kiếm" in aria or "tim kiem" in aria or "search" in aria:
            return True
    except Exception:
        pass
    return False


def _locate_soan_tin_nhan(page):
    """O nhap 'Soạn tin nhắn' (man hinh gui anh hoac chat)."""
    tries = (
        page.get_by_role("textbox", name=_COMPOSE_MESSAGE_LABEL),
        page.locator('div[contenteditable="true"][aria-label="Soạn tin nhắn"]'),
        page.locator('div[contenteditable="true"][aria-label*="Soạn tin"]'),
        page.locator(
            '[data-testid="conversation-compose-box-input"] div[contenteditable="true"]'
        ),
        page.locator('[data-testid="media-caption-input-container"] div[contenteditable="true"]'),
        _main_panel(page).locator("footer div[contenteditable='true']"),
        page.locator("footer div[contenteditable='true']"),
    )
    for loc in tries:
        try:
            n = loc.count()
        except Exception:
            continue
        for i in range(min(n, 6)):
            box = loc.nth(i)
            try:
                if not box.is_visible(timeout=800):
                    continue
                if _is_search_compose(box):
                    continue
                return box
            except Exception:
                continue
    return None


def _fill_soan_tin_nhan(
    page,
    message: str,
    on_progress: Callable[[str], None] | None = None,
) -> None:
    """Dien 'Soạn tin nhắn' (goi sau khi da co o nhap)."""
    if not message.strip():
        return
    box = _locate_soan_tin_nhan(page)
    if box is None:
        _log_compose_debug(page, on_progress)
        raise TimeoutError("Khong tim thay o 'Soạn tin nhắn'")
    _type_in_contenteditable(box, page, message)
    time.sleep(0.25)


def _wait_until_media_sent(
    page,
    timeout_ms: int = 90_000,
    on_progress: Callable[[str], None] | None = None,
) -> bool:
    """Cho man hinh preview anh dong (da gui xong)."""
    deadline = time.time() + timeout_ms / 1000
    last_log = 0.0
    while time.time() < deadline:
        if not _media_preview_open(page):
            time.sleep(0.8)
            return True
        now = time.time()
        if on_progress and now - last_log >= 8.0:
            on_progress("    Dang upload / gui (Enter)...")
            last_log = now
        time.sleep(0.4)
    return not _media_preview_open(page)


def _send_with_enter(
    page,
    on_progress: Callable[[str], None] | None = None,
) -> None:
    """Buoc cuoi: Enter de gui (dung khi focus o Soạn tin nhắn kem anh)."""
    if on_progress:
        on_progress("    Buoc 3: Enter de gui")
    page.keyboard.press("Enter")
    if not _wait_until_media_sent(page, on_progress=on_progress):
        if on_progress:
            on_progress("    Thu Enter lan 2...")
        page.keyboard.press("Enter")
        if not _wait_until_media_sent(page, timeout_ms=45_000, on_progress=on_progress):
            raise TimeoutError("Khong gui duoc anh sau Enter (preview van mo)")


def _send_text_in_chat(
    page, text: str, on_progress: Callable[[str], None] | None = None
) -> None:
    """Gui tin text thuan (che do split)."""
    if not text.strip():
        return
    if not _wait_for_soan_tin_nhan(page, timeout_ms=15_000):
        raise TimeoutError("Khong tim thay o 'Soạn tin nhắn'")
    _fill_soan_tin_nhan(page, text, on_progress=on_progress)
    page.keyboard.press("Enter")
    time.sleep(1.2)


def _media_preview_open(page) -> bool:
    for sel in (
        '[data-testid="media-editor"]',
        '[data-testid="media-viewer"]',
        '[data-testid="media-viewer-root"]',
    ):
        loc = page.locator(sel).first
        if loc.count() == 0:
            continue
        try:
            if loc.is_visible(timeout=400):
                return True
        except Exception:
            continue
    return False


def _send_image_attachment(
    page,
    image_path: Path,
    on_progress: Callable[[str], None] | None = None,
) -> None:
    if on_progress:
        on_progress(f"    Dinh kem anh: {image_path.name}")
    _attach_file(page, image_path, "photo")
    if not _wait_for_soan_tin_nhan(page, timeout_ms=20_000):
        page.keyboard.press("Enter")
        _wait_until_media_sent(page, on_progress=on_progress)
        return
    _send_with_enter(page, on_progress=on_progress)


def _send_combined_image_with_text(
    page,
    image_path: Path,
    compose_text: str,
    on_progress: Callable[[str], None] | None = None,
) -> None:
    """Chuan: Anh & video -> Soạn tin nhắn -> Enter."""
    if on_progress:
        on_progress(f"    Buoc 1: Dinh kem Anh & video — {image_path.name}")
    _attach_file(page, image_path, "photo")
    if on_progress:
        on_progress("    Cho o Soạn tin nhắn...")
    if not _wait_for_soan_tin_nhan(page, timeout_ms=25_000):
        _log_compose_debug(page, on_progress)
        raise TimeoutError("Khong thay o Soạn tin nhắn sau khi dinh kem anh")
    if compose_text.strip():
        if on_progress:
            on_progress(f"    Buoc 2: Dien Soạn tin nhắn — {compose_text}")
        _fill_soan_tin_nhan(page, compose_text, on_progress=on_progress)
    _send_with_enter(page, on_progress=on_progress)
    time.sleep(1.0)


def send_images(
    page,
    image_paths: list[Path],
    *,
    message_team: str = "",
    send_mode: str = "combined",
    on_progress: Callable[[str], None] | None = None,
) -> None:
    """WhatsApp Web: moi anh co text rieng (XLSC / TKM)."""
    mode = (send_mode or "combined").strip().lower()
    for idx, image_path in enumerate(image_paths, start=1):
        compose_text = caption_for_image(image_path, message_team)
        if on_progress:
            on_progress(
                f"  [{idx}/{len(image_paths)}] {image_path.name} (che do: {mode})"
            )
        if mode != "split":
            _send_combined_image_with_text(
                page, image_path, compose_text, on_progress=on_progress
            )
            continue

        if compose_text:
            if on_progress:
                on_progress(f"    Gui text: {compose_text}")
            _send_text_in_chat(page, compose_text, on_progress=on_progress)
            time.sleep(1.0)
        _send_image_attachment(page, image_path, on_progress=on_progress)


def run_whatsapp_send(
    teams_map: dict[str, str],
    out_root: Path,
    *,
    message_labels: dict[str, str] | None = None,
    on_progress: Callable[[str], None] | None = None,
    headless: bool = False,
) -> None:
    from playwright.sync_api import sync_playwright

    labels = message_labels or {}
    jobs: list[tuple[str, str, str, list[Path]]] = []
    for team, group_name in teams_map.items():
        group_name = (group_name or "").strip()
        if not group_name:
            continue
        safe = re.sub(r'[<>:"/\\|?*]', "_", team).strip()
        folder = out_root / safe
        if not folder.is_dir():
            if on_progress:
                on_progress(f"  Bo qua {team}: khong co thu muc anh")
            continue
        images = sorted(
            folder.glob("*.png"),
            key=lambda p: (0 if "_XLSC" in p.name.upper() else 1, p.name),
        )
        if images:
            msg_team = (labels.get(team) or team).strip() or team
            jobs.append((team, group_name, msg_team, images))

    if not jobs:
        if on_progress:
            on_progress("Khong co nhom nao de gui (kiem tra ten nhom / anh).")
        return

    if on_progress:
        on_progress(f"Gui {len(jobs)} nhom tu {out_root}")

    cfg = load_json(ROOT / "config.json")
    browser_pref = str(cfg.get("whatsapp_browser", "chrome"))
    browser_strict = bool(cfg.get("whatsapp_browser_strict", True))
    send_mode = str(cfg.get("whatsapp_send_mode", "combined"))
    profile_dir = resolve_whatsapp_profile(cfg)
    profile_dir.mkdir(parents=True, exist_ok=True)
    ensure_playwright_for_whatsapp(cfg, on_progress)

    with sync_playwright() as p:
        context, browser_name, browser_detail = launch_whatsapp_context(
            p,
            headless=headless,
            browser_pref=browser_pref,
            strict=browser_strict,
            profile_dir=profile_dir,
        )
        if on_progress:
            on_progress(
                f"Trinh duyet WhatsApp: {browser_name} "
                f"(config whatsapp_browser={browser_pref}, strict={browser_strict})"
            )
            if browser_detail:
                on_progress(f"Chrome/Edge path: {browser_detail}")
            on_progress(f"Profile WhatsApp: {profile_dir}")
            on_progress(
                f"Che do gui: {send_mode} "
                "(combined = dinh kem anh -> Soạn tin nhắn -> gui)"
            )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(WA_URL, wait_until="domcontentloaded")
        wait_for_logged_in(page)
        try:
            ua = page.evaluate("navigator.userAgent")
            if on_progress and ua:
                on_progress(f"User-Agent: {ua[:120]}...")
        except Exception:
            pass

        for team, group_name, msg_team, images in jobs:
            if on_progress:
                on_progress(
                    f"Gui: {team} -> {group_name} ({len(images)} anh, ten tin: {msg_team})"
                )
            try:
                open_group_chat(page, group_name)
                send_images(
                    page,
                    images,
                    message_team=msg_team,
                    send_mode=send_mode,
                    on_progress=on_progress,
                )
            except Exception as exc:
                if on_progress:
                    on_progress(f"  Loi {team}: {exc}")

        context.close()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Gui anh len WhatsApp theo teams_whatsapp.json")
    parser.add_argument("--date", dest="run_date", help="Ngay thu muc output YYYY-MM-DD")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Khong khuyen nghi: can QR lan dau",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chi in danh sach se gui, khong mo trinh duyet",
    )
    parser.add_argument(
        "--team",
        action="append",
        dest="teams",
        help="Chi gui cac doi duoc chi dinh (trung voi cot Gui tren GUI)",
    )
    args = parser.parse_args()

    cfg = load_json(ROOT / "config.json")
    cache = load_cache()
    all_teams = cache.get("teams", {})
    teams_map = teams_for_whatsapp(all_teams)
    if args.teams:
        pick = set(args.teams)
        teams_map = {k: v for k, v in teams_map.items() if k in pick}
    message_labels = {
        team: message_text_for_team(all_teams, team) for team in teams_map
    }

    run_day = args.run_date or date.today().isoformat()
    out_root = ROOT / cfg.get("output_dir", "output") / run_day

    if not out_root.is_dir():
        print(f"Khong tim thay thu muc anh: {out_root}", file=sys.stderr)
        print("Chay export_team_images.py truoc.", file=sys.stderr)
        return 1

    jobs: list[tuple[str, str, list[Path]]] = []
    for team, group_name in teams_map.items():
        group_name = (group_name or "").strip()
        if not group_name:
            continue
        safe = re.sub(r'[<>:"/\\|?*]', "_", team).strip()
        folder = out_root / safe
        if not folder.is_dir():
            continue
        images = sorted(
            folder.glob("*.png"),
            key=lambda p: (0 if "_XLSC" in p.name.upper() else 1, p.name),
        )
        if images:
            jobs.append((team, group_name, images))

    if not jobs:
        print("Khong co nhom WhatsApp nao duoc cau hinh (ten trong) hoac khong co anh.")
        print("Dien ten nhom vao teams_whatsapp.json roi chay lai.")
        return 0

    print(f"Se gui {len(jobs)} nhom WhatsApp tu {out_root}")
    for team, group, imgs in jobs:
        msg_team = message_labels.get(team, team)
        print(f"  - {team} -> {group} ({len(imgs)} anh, ten tin: {msg_team})")
        for img in imgs:
            cap = caption_for_image(img, msg_team)
            if cap:
                print(f"      {img.name}: {cap}")

    if args.dry_run:
        return 0

    def progress(msg: str) -> None:
        print(msg)

    try:
        run_whatsapp_send(
            dict((team, group) for team, group, _ in jobs),
            out_root,
            message_labels=message_labels,
            on_progress=progress,
            headless=args.headless,
        )
    except ImportError:
        print("Chua cai playwright. Chay: py -3 -m pip install -r requirements.txt", file=sys.stderr)
        print("Sau do: py -3 -m playwright install chromium", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
