"""
Dead Man's Switch (48-Hour Inactivity Auto-Destruct Daemon) for IronChat.
"""

import asyncio
import time
import logging
from app.config import DEAD_MAN_TIMEOUT
from app.database import get_global_interaction
from app.shredder import panic_wipe_all_data

logger = logging.getLogger("DeadManSwitch")

class DeadManSwitchDaemon:
    def __init__(self, check_interval_seconds: int = 60):
        self.check_interval = check_interval_seconds
        self.running = False

    async def start(self):
        self.running = True
        logger.info(f"Dead Man's Switch active. Timeout: {DEAD_MAN_TIMEOUT}s (48 hours).")
        while self.running:
            try:
                await asyncio.sleep(self.check_interval)
                last_active = get_global_interaction()
                now = time.time()
                elapsed = now - last_active

                # If more than configured timeout (default 48h) without any user activity, trigger full wipe!
                if elapsed >= DEAD_MAN_TIMEOUT:
                    logger.critical(
                        f"⚠️ [DEAD MAN'S SWITCH TRIGGERED] {elapsed:.1f}s without activity! Initiating emergency wipe!"
                    )
                    panic_wipe_all_data(reboot_container=True)
                    self.running = False
                    break
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in DeadManSwitchDaemon: {e}")

    def stop(self):
        self.running = False
