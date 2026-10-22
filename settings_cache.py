"""Luu / doc cau hinh nhom WhatsApp theo doi (cache)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_PATH = ROOT / "settings_cache.json"
LEGACY_PATH = ROOT / "teams_whatsapp.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def default_cache() -> dict:
    return {
        "version": 1,
        "last_workbook": "",
        "updated_at": "",
        "teams": {},
    }


def load_cache() -> dict:
    if CACHE_PATH.is_file():
        with CACHE_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if "teams" in data:
            return data

    if LEGACY_PATH.is_file():
        with LEGACY_PATH.open(encoding="utf-8") as f:
            legacy = json.load(f)
        teams = legacy.get("teams", {})
        normalized = {
            name: {
                "whatsapp_group": (grp or "").strip(),
                "send": bool((grp or "").strip()),
                "message_text": name,
            }
            for name, grp in teams.items()
        }
        return {
            "version": 1,
            "last_workbook": "",
            "updated_at": "",
            "teams": normalized,
        }

    return default_cache()


def save_cache(data: dict) -> None:
    data = dict(data)
    data["updated_at"] = _now_iso()
    with CACHE_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    _sync_legacy_teams_whatsapp(data.get("teams", {}))


def _sync_legacy_teams_whatsapp(teams: dict) -> None:
    flat = {}
    for name, item in teams.items():
        if isinstance(item, dict):
            flat[name] = (item.get("whatsapp_group") or "").strip()
        else:
            flat[name] = str(item or "").strip()
    payload = {
        "_huong_dan": "File dong bo tu settings_cache.json (GUI).",
        "teams": flat,
    }
    with LEGACY_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def merge_teams_from_excel(excel_teams: list[str], cache: dict) -> dict[str, dict]:
    """Giu ten nhom da luu; doi moi tu Excel co nhom trong."""
    old = cache.get("teams") or {}
    merged: dict[str, dict] = {}
    for team in excel_teams:
        prev = old.get(team) if isinstance(old.get(team), dict) else {}
        if not isinstance(prev, dict):
            prev = {"whatsapp_group": str(old.get(team) or ""), "send": True}
        msg = (prev.get("message_text") or team).strip() if isinstance(prev, dict) else team
        merged[team] = {
            "whatsapp_group": (prev.get("whatsapp_group") or "").strip(),
            "send": bool(prev.get("send", True)),
            "message_text": msg or team,
        }
    return merged


def message_text_for_team(teams: dict[str, dict], team: str) -> str:
    cfg = teams.get(team) if isinstance(teams.get(team), dict) else {}
    if not isinstance(cfg, dict):
        cfg = {}
    text = (cfg.get("message_text") or team).strip()
    return text or team


def teams_for_export(teams: dict[str, dict]) -> list[str] | None:
    """None = tat ca doi co trong file; list = chi cac doi duoc bat."""
    enabled = [n for n, c in teams.items() if c.get("send", True)]
    return enabled if enabled else None


def teams_for_whatsapp(teams: dict[str, dict]) -> dict[str, str]:
    out = {}
    for name, cfg in teams.items():
        if not cfg.get("send", True):
            continue
        grp = (cfg.get("whatsapp_group") or "").strip()
        if grp:
            out[name] = grp
    return out
