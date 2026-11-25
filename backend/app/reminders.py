"""Persistent reminder storage for AcneLyze (SQLite)."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .config import settings

DB_PATH = settings.data_dir / "reminders.db"
CATEGORIES = {"medicine", "self_monitoring"}
REPEATS = {"never", "daily", "weekly", "custom"}


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              category TEXT NOT NULL,
              title TEXT NOT NULL,
              times_json TEXT NOT NULL,
              repeat TEXT NOT NULL,
              weekdays_json TEXT NOT NULL,
              custom_dates_json TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              next_at TEXT,
              last_notified_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS reminders_user_idx ON reminders(user_id, created_at DESC)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reminder_notifications (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              reminder_id TEXT NOT NULL,
              title TEXT NOT NULL,
              category TEXT NOT NULL,
              notified_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS reminder_notifications_user_idx ON reminder_notifications(user_id, notified_at DESC)"
        )


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _parse_hhmm(value: str) -> tuple[int, int] | None:
    if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
        return None
    try:
        h = int(value[:2]); m = int(value[3:])
    except ValueError:
        return None
    if 0 <= h <= 23 and 0 <= m <= 59:
        return h, m
    return None


def _normalize_times(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for v in values:
        hm = _parse_hhmm(str(v).strip())
        if not hm:
            continue
        t = f"{hm[0]:02d}:{hm[1]:02d}"
        if t not in out:
            out.append(t)
    out.sort()
    return out


def _normalize_weekdays(values: Any) -> list[int]:
    if not isinstance(values, list):
        return []
    out: list[int] = []
    for v in values:
        try:
            i = int(v)
        except Exception:
            continue
        if 0 <= i <= 6 and i not in out:
            out.append(i)
    out.sort()
    return out


def _normalize_dates(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for v in values:
        if not isinstance(v, str):
            continue
        try:
            d = datetime.strptime(v[:10], "%Y-%m-%d").date()
        except Exception:
            continue
        s = d.isoformat()
        if s not in out:
            out.append(s)
    out.sort()
    return out


def compute_next_at(reminder: dict[str, Any], after: datetime | None = None) -> str | None:
    if not reminder.get("enabled"):
        return None
    times = _normalize_times(reminder.get("times"))
    if not times:
        return None
    repeat = str(reminder.get("repeat", "never"))
    now = (after or datetime.now().astimezone()).replace(second=0, microsecond=0)
    weekdays = _normalize_weekdays(reminder.get("weekdays"))
    custom_dates = _normalize_dates(reminder.get("custom_dates"))

    candidates: list[datetime] = []
    if repeat == "never":
        # once: today if future, else tomorrow? better use custom-like single date not stored; interpret as next occurrence today or first future
        for t in times:
            h, m = map(int, t.split(":"))
            c = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if c <= now:
                c = c + timedelta(days=1)
            candidates.append(c)
    elif repeat == "daily":
        for day_offset in range(0, 8):
            d = (now + timedelta(days=day_offset)).date()
            for t in times:
                h, m = map(int, t.split(":"))
                c = datetime(d.year, d.month, d.day, h, m, tzinfo=now.tzinfo)
                if c > now:
                    candidates.append(c)
    elif repeat == "weekly":
        days = weekdays or [now.weekday() if False else now.weekday()]  # fallback
        # weekdays use 0=Sun..6=Sat in frontend; convert
        allowed = set(weekdays)
        for day_offset in range(0, 15):
            d = now + timedelta(days=day_offset)
            sun0 = (d.weekday() + 1) % 7  # Mon0->Sun0? Python Mon=0..Sun=6; we want Sun=0
            if allowed and sun0 not in allowed:
                continue
            for t in times:
                h, m = map(int, t.split(":"))
                c = d.replace(hour=h, minute=m, second=0, microsecond=0)
                if c > now:
                    candidates.append(c)
    elif repeat == "custom":
        for ds in custom_dates:
            try:
                d = datetime.strptime(ds, "%Y-%m-%d").date()
            except Exception:
                continue
            for t in times:
                h, m = map(int, t.split(":"))
                c = datetime(d.year, d.month, d.day, h, m, tzinfo=now.tzinfo)
                if c > now:
                    candidates.append(c)
    else:
        return None

    if not candidates:
        return None
    return min(candidates).isoformat(timespec="seconds")


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "category": row["category"],
        "title": row["title"],
        "times": json.loads(row["times_json"]),
        "repeat": row["repeat"],
        "weekdays": json.loads(row["weekdays_json"]),
        "custom_dates": json.loads(row["custom_dates_json"]),
        "enabled": bool(row["enabled"]),
        "next_at": row["next_at"],
        "last_notified_at": row["last_notified_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _validate(payload: dict[str, Any], user_id: str, existing_id: str | None = None) -> dict[str, Any]:
    category = str(payload.get("category", "")).strip()
    if category not in CATEGORIES:
        raise ValueError("category must be 'medicine' or 'self_monitoring'")
    title = str(payload.get("title", "")).strip()
    if not title:
        raise ValueError("title is required")
    if len(title) > 120:
        raise ValueError("title is too long")
    times = _normalize_times(payload.get("times"))
    if not times:
        raise ValueError("at least one valid time is required")
    repeat = str(payload.get("repeat", "daily")).strip()
    if repeat not in REPEATS:
        raise ValueError("invalid repeat value")
    weekdays = _normalize_weekdays(payload.get("weekdays"))
    custom_dates = _normalize_dates(payload.get("custom_dates"))
    if repeat == "weekly" and not weekdays:
        raise ValueError("select at least one weekday for weekly reminders")
    if repeat == "custom" and not custom_dates:
        raise ValueError("select at least one date for custom reminders")
    enabled = bool(payload.get("enabled", True))
    now = _now_iso()
    rid = existing_id or str(payload.get("id") or uuid.uuid4())
    data = {
        "id": rid,
        "user_id": user_id,
        "category": category,
        "title": title,
        "times": times,
        "repeat": repeat,
        "weekdays": weekdays if repeat == "weekly" else [],
        "custom_dates": custom_dates if repeat == "custom" else [],
        "enabled": enabled,
        "last_notified_at": payload.get("last_notified_at") if isinstance(payload.get("last_notified_at"), str) else None,
        "created_at": str(payload.get("created_at") or now),
        "updated_at": now,
    }
    data["next_at"] = compute_next_at(data)
    return data


def list_reminders(user_id: str) -> list[dict[str, Any]]:
    init_db()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE user_id=? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_reminder(user_id: str, reminder_id: str) -> dict[str, Any] | None:
    init_db()
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM reminders WHERE user_id=? AND id=?", (user_id, reminder_id)
        ).fetchone()
    return _row_to_dict(row) if row else None


def upsert_reminder(user_id: str, payload: dict[str, Any], reminder_id: str | None = None) -> dict[str, Any]:
    init_db()
    existing = get_reminder(user_id, reminder_id) if reminder_id else None
    if reminder_id and not existing:
        raise KeyError("reminder not found")
    data = _validate(payload, user_id, reminder_id)
    if existing:
        data["created_at"] = existing["created_at"]
        if not payload.get("last_notified_at"):
            data["last_notified_at"] = existing.get("last_notified_at")
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO reminders (id,user_id,category,title,times_json,repeat,weekdays_json,custom_dates_json,enabled,next_at,last_notified_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              category=excluded.category,title=excluded.title,times_json=excluded.times_json,repeat=excluded.repeat,
              weekdays_json=excluded.weekdays_json,custom_dates_json=excluded.custom_dates_json,enabled=excluded.enabled,
              next_at=excluded.next_at,last_notified_at=excluded.last_notified_at,updated_at=excluded.updated_at
            """,
            (
                data["id"], data["user_id"], data["category"], data["title"], json.dumps(data["times"]),
                data["repeat"], json.dumps(data["weekdays"]), json.dumps(data["custom_dates"]),
                1 if data["enabled"] else 0, data["next_at"], data["last_notified_at"], data["created_at"], data["updated_at"],
            ),
        )
    return data


def delete_reminder(user_id: str, reminder_id: str) -> bool:
    init_db()
    with _conn() as conn:
        cur = conn.execute("DELETE FROM reminders WHERE user_id=? AND id=?", (user_id, reminder_id))
        conn.execute("DELETE FROM reminder_notifications WHERE user_id=? AND reminder_id=?", (user_id, reminder_id))
    return cur.rowcount > 0


def set_enabled(user_id: str, reminder_id: str, enabled: bool) -> dict[str, Any]:
    existing = get_reminder(user_id, reminder_id)
    if not existing:
        raise KeyError("reminder not found")
    existing["enabled"] = bool(enabled)
    return upsert_reminder(user_id, existing, reminder_id)


def mark_notified(user_id: str, reminder_id: str, notified_at: str | None = None) -> dict[str, Any]:
    existing = get_reminder(user_id, reminder_id)
    if not existing:
        raise KeyError("reminder not found")
    ts = (notified_at or _now_iso()).replace("Z", "+00:00")
    existing["last_notified_at"] = ts
    try:
        after_dt = datetime.fromisoformat(ts)
    except Exception:
        after_dt = datetime.now().astimezone()
    existing["next_at"] = compute_next_at(existing, after=after_dt)
    if existing["repeat"] == "never" and not existing["next_at"]:
        existing["enabled"] = False
    data = upsert_reminder(user_id, existing, reminder_id)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO reminder_notifications (id,user_id,reminder_id,title,category,notified_at) VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), user_id, reminder_id, data["title"], data["category"], ts),
        )
    return data


def list_notifications(user_id: str, limit: int = 30) -> list[dict[str, Any]]:
    init_db()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM reminder_notifications WHERE user_id=? ORDER BY notified_at DESC LIMIT ?",
            (user_id, max(1, min(100, int(limit)))),
        ).fetchall()
    return [dict(r) for r in rows]
