"""
Burn-After-Reading (Self-Destruct) and Rolling Retention Engine for IronChat.
"""

import asyncio
import logging
from typing import Optional, Dict, Any, Callable, Coroutine
from app.config import FILES_DIR
from app.database import (
    get_db_connection,
    mark_message_read,
    get_expired_messages,
    get_expired_retention_messages,
    mark_message_burned,
)
from app.shredder import shred_file

logger = logging.getLogger("BurnEngine")

BURN_MODE_MAP = {
    "immediate": 5,     # 5 seconds after opening
    "10s": 10,
    "30s": 30,
    "1m": 60,
    "5m": 300,
    "1h": 3600,
    "24h": 86400,
    "never": None
}

def parse_burn_seconds(mode: str) -> Optional[int]:
    return BURN_MODE_MAP.get(mode, None)

class BurnEngine:
    def __init__(self, broadcast_callback: Optional[Callable[[Dict[str, Any]], Coroutine]] = None):
        self.broadcast_callback = broadcast_callback
        self.running = False

    async def trigger_read(self, msg_id: str, reader: str) -> Optional[Dict[str, Any]]:
        """Trigger reading of a message; broadcast read receipt and start countdown if burnable."""
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM messages WHERE id = ? AND is_burned = 0", (msg_id,))
            row = cur.fetchone()
            if not row:
                return None
            if row["sender"] == reader or row["read_at"] is not None:
                return dict(row)
            burn_mode = row["burn_mode"]
            burn_sec = parse_burn_seconds(burn_mode)
        finally:
            conn.close()

        updated_msg = mark_message_read(msg_id, reader, burn_sec)
        if updated_msg and updated_msg.get("read_at") and self.broadcast_callback:
            await self.broadcast_callback({
                "type": "message_read",
                "msg_id": msg_id,
                "read_at": updated_msg["read_at"],
                "burn_at": updated_msg.get("burn_at"),
                "burn_mode": burn_mode
            })
            if updated_msg.get("burn_at"):
                await self.broadcast_callback({
                    "type": "message_countdown",
                    "msg_id": msg_id,
                    "burn_at": updated_msg["burn_at"],
                    "burn_mode": burn_mode
                })
        return updated_msg

    async def start(self):
        self.running = True
        logger.info("Burn Engine started.")
        retention_check_counter = 0
        while self.running:
            try:
                await asyncio.sleep(1)
                retention_check_counter += 1

                # 1. Process regular burn-after-reading expired messages (per-second precision)
                expired_list = get_expired_messages()

                # 2. Check 7-day rolling retention expiry every 60 seconds
                if retention_check_counter >= 60:
                    retention_check_counter = 0
                    try:
                        retention_expired = get_expired_retention_messages()
                        if retention_expired:
                            existing_ids = {m["id"] for m in expired_list}
                            for r_msg in retention_expired:
                                if r_msg["id"] not in existing_ids:
                                    expired_list.append(r_msg)
                    except Exception as re_err:
                        logger.error(f"Error checking retention messages: {re_err}")

                for msg in expired_list:
                    msg_id = msg["id"]
                    file_id = msg.get("file_id")

                    # Physically shred associated file
                    if file_id:
                        fpath = FILES_DIR / file_id
                        if fpath.exists():
                            shred_file(fpath)

                    # Delete row from DB
                    mark_message_burned(msg_id)

                    # Broadcast burn event to both users
                    if self.broadcast_callback:
                        await self.broadcast_callback({
                            "type": "message_burned",
                            "msg_id": msg_id
                        })
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in BurnEngine loop: {e}")

    def stop(self):
        self.running = False
