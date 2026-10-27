"""
SQLite Database and Storage Module for IronChat.
Configured with WAL mode for high concurrency and zero-leakage ephemeral storage.
"""

import hashlib
import sqlite3
import time
from typing import Optional, List, Dict, Any
from app.config import DB_PATH, ALLOWED_USERS, MESSAGE_RETENTION_SECONDS

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

def init_db() -> None:
    """Initialize database tables and seed allowed users if empty."""
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    totp_secret TEXT,
                    is_activated INTEGER DEFAULT 0,
                    created_at REAL,
                    last_active REAL
                );
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    sender TEXT NOT NULL,
                    ciphertext TEXT NOT NULL,
                    iv TEXT NOT NULL,
                    msg_type TEXT NOT NULL,
                    file_id TEXT,
                    file_name TEXT,
                    file_size INTEGER DEFAULT 0,
                    burn_mode TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    read_at REAL,
                    burn_at REAL,
                    is_burned INTEGER DEFAULT 0,
                    reply_to_id TEXT,
                    reply_to_sender TEXT,
                    reply_to_text TEXT
                );
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    endpoint TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    subscription_json TEXT NOT NULL,
                    device_name TEXT DEFAULT '',
                    user_agent TEXT DEFAULT '',
                    ip TEXT DEFAULT '',
                    created_at REAL NOT NULL
                );
            """)

            # Ensure the two allowed users exist in users table
            now = time.time()
            for user in ALLOWED_USERS:
                conn.execute("""
                    INSERT OR IGNORE INTO users (username, totp_secret, is_activated, created_at, last_active)
                    VALUES (?, NULL, 0, ?, ?);
                """, (user, now, now))

            # Initialize global last interaction timestamp
            conn.execute("""
                INSERT OR IGNORE INTO system_state (key, value)
                VALUES ('last_interaction', ?);
            """, (str(now),))
    finally:
        conn.close()

def get_user(username: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def activate_user(username: str, totp_secret: str) -> None:
    conn = get_db_connection()
    now = time.time()
    try:
        with conn:
            conn.execute("""
                UPDATE users
                SET totp_secret = ?, is_activated = 1, last_active = ?
                WHERE username = ?
            """, (totp_secret, now, username))
    finally:
        conn.close()

def reset_user_totp(username: str) -> None:
    """Reset a user's TOTP binding so they can re-enroll with a new QR code while preserving chat history."""
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                UPDATE users
                SET totp_secret = NULL, is_activated = 0
                WHERE username = ?
            """, (username,))
    finally:
        conn.close()

def update_user_activity(username: str) -> None:
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                UPDATE users SET last_active = ? WHERE username = ?
            """, (now, username))
            conn.execute("""
                INSERT OR REPLACE INTO system_state (key, value)
                VALUES ('last_interaction', ?)
            """, (str(now),))
    finally:
        conn.close()

def update_global_interaction() -> None:
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO system_state (key, value)
                VALUES ('last_interaction', ?)
            """, (str(now),))
    finally:
        conn.close()

def get_global_interaction() -> float:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM system_state WHERE key = 'last_interaction'")
        row = cur.fetchone()
        return float(row["value"]) if row else time.time()
    except Exception:
        return time.time()
    finally:
        conn.close()

# ----------------- Message Operations -----------------

def create_message(data: Dict[str, Any]) -> None:
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO messages (
                    id, sender, ciphertext, iv, msg_type,
                    file_id, file_name, file_size, burn_mode,
                    created_at, read_at, burn_at, is_burned,
                    reply_to_id, reply_to_sender, reply_to_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);
            """, (
                data["id"],
                data["sender"],
                data["ciphertext"],
                data["iv"],
                data["msg_type"],
                data.get("file_id"),
                data.get("file_name"),
                data.get("file_size", 0),
                data["burn_mode"],
                data["created_at"],
                data.get("read_at"),
                data.get("burn_at"),
                data.get("reply_to_id"),
                data.get("reply_to_sender"),
                data.get("reply_to_text"),
            ))
            conn.execute("""
                INSERT OR REPLACE INTO system_state (key, value)
                VALUES ('last_interaction', ?)
            """, (str(data["created_at"]),))
    finally:
        conn.close()

def get_active_messages(retention_seconds: int = MESSAGE_RETENTION_SECONDS) -> List[Dict[str, Any]]:
    """Retrieve all active unburned messages within the 7-day rolling retention window."""
    cutoff = time.time() - retention_seconds
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM messages
            WHERE is_burned = 0 AND created_at > ?
            ORDER BY created_at ASC
        """, (cutoff,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def get_expired_messages() -> List[Dict[str, Any]]:
    """Retrieve messages whose burn_at has arrived."""
    now = time.time()
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM messages
            WHERE is_burned = 0 AND burn_at IS NOT NULL AND burn_at <= ?
        """, (now,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def get_expired_retention_messages(retention_seconds: int = MESSAGE_RETENTION_SECONDS) -> List[Dict[str, Any]]:
    """Retrieve messages exceeding the 7-day retention period."""
    cutoff = time.time() - retention_seconds
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM messages
            WHERE is_burned = 0 AND created_at <= ?
        """, (cutoff,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def mark_message_read(msg_id: str, reader: str, burn_seconds: Optional[int]) -> Optional[Dict[str, Any]]:
    """Mark a message as read by peer and activate countdown if burn_mode applies."""
    now = time.time()
    burn_at = (now + burn_seconds) if burn_seconds else None
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM messages WHERE id = ? AND is_burned = 0
            """, (msg_id,))
            msg = cur.fetchone()
            if not msg:
                return None

            # If sender views their own message or already read, return as is
            if msg["sender"] == reader or msg["read_at"] is not None:
                return dict(msg)

            cur.execute("""
                UPDATE messages
                SET read_at = ?, burn_at = ?
                WHERE id = ?
            """, (now, burn_at, msg_id))

            cur.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
            updated = cur.fetchone()
            return dict(updated) if updated else None
    finally:
        conn.close()

def mark_message_burned(msg_id: str) -> Optional[Dict[str, Any]]:
    """Mark message as burned and physically delete its database record."""
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
            row = cur.fetchone()
            if not row:
                return None
            msg_dict = dict(row)
            cur.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
            return msg_dict
    finally:
        conn.close()

# ----------------- Web Push Subscriptions -----------------

def save_push_subscription(
    username: str,
    endpoint: str,
    subscription_json: str,
    device_name: str = "",
    user_agent: str = "",
    ip: str = ""
) -> None:
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO push_subscriptions (endpoint, username, subscription_json, device_name, user_agent, ip, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET
                    username = excluded.username,
                    subscription_json = excluded.subscription_json,
                    device_name = excluded.device_name,
                    user_agent = excluded.user_agent,
                    ip = excluded.ip,
                    created_at = excluded.created_at
            """, (endpoint, username, subscription_json, device_name, user_agent, ip, now))
    finally:
        conn.close()

def get_user_push_subscriptions(username: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM push_subscriptions WHERE username = ?", (username,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def get_user_push_devices(username: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT endpoint, device_name, user_agent, ip, created_at
            FROM push_subscriptions
            WHERE username = ?
            ORDER BY created_at DESC
        """, (username,))
        devices = []
        for r in cur.fetchall():
            d = dict(r)
            ep = d.get("endpoint", "")
            d["id"] = hashlib.sha256(ep.encode("utf-8")).hexdigest()[:16]
            d["endpoint_masked"] = (ep[:30] + "..." + ep[-10:]) if len(ep) > 40 else ep
            devices.append(d)
        return devices
    finally:
        conn.close()

def delete_push_subscription(endpoint: str) -> None:
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    finally:
        conn.close()

def delete_push_subscription_by_id(username: str, device_id: str) -> bool:
    subs = get_user_push_devices(username)
    for sub in subs:
        if sub.get("id") == device_id:
            conn = get_db_connection()
            try:
                with conn:
                    conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (sub["endpoint"],))
                return True
            finally:
                conn.close()
    return False

def delete_all_user_push_subscriptions(username: str) -> int:
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM push_subscriptions WHERE username = ?", (username,))
            return cur.rowcount
    finally:
        conn.close()

# ----------------- System State KV Store -----------------

def get_system_state(key: str) -> Optional[str]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM system_state WHERE key = ?", (key,))
        row = cur.fetchone()
        return row["value"] if row else None
    finally:
        conn.close()

def set_system_state(key: str, value: str) -> None:
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO system_state (key, value)
                VALUES (?, ?)
            """, (key, value))
    finally:
        conn.close()
