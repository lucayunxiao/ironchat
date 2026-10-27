"""
Secure Data Shredding and Emergency Wipe Module for IronChat.
Performs multi-pass random byte overwriting (DoD / NIST compliant concept)
before file unlinking to prevent physical disk recovery.
"""

import os
import shutil
import threading
import time
from pathlib import Path
from typing import Optional
from app.config import DATA_DIR, FILES_DIR, DB_PATH, STATE_FILE

def shred_file(path: Path, passes: int = 2) -> bool:
    """
    Physically overwrite file with random bytes before deletion to prevent recovery.
    """
    try:
        if not path.is_file():
            return False

        file_size = path.stat().st_size
        if file_size > 0:
            chunk_size = 64 * 1024  # 64KB chunks
            with open(path, "r+b") as f:
                for _ in range(passes):
                    f.seek(0)
                    remaining = file_size
                    while remaining > 0:
                        n = min(remaining, chunk_size)
                        f.write(os.urandom(n))
                        remaining -= n
                    f.flush()
                    os.fsync(f.fileno())

        # Truncate and unlink
        with open(path, "w") as f:
            f.truncate(0)
        path.unlink(missing_ok=True)
        return True
    except Exception:
        # Fallback to direct unlink if write failed
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return False

def panic_wipe_all_data(reboot_container: bool = True) -> dict:
    """
    [🚨 Panic Destruct / 删库跑路]:
    Completely shred all messages, files, TOTP keys, state, and database files,
    then reboot container to reset to factory unactivated state.
    """
    shredded_files = 0

    # 1. Shred all uploaded media files
    if FILES_DIR.exists():
        for f in FILES_DIR.glob("*"):
            if f.is_file():
                if shred_file(f):
                    shredded_files += 1

    # 2. Shred SQLite DB and journal files
    db_files = [
        DB_PATH,
        Path(str(DB_PATH) + "-wal"),
        Path(str(DB_PATH) + "-shm"),
        STATE_FILE,
    ]
    for db_f in db_files:
        if db_f.exists():
            shred_file(db_f)
            shredded_files += 1

    # 3. Clean up any leftover subdirectories
    try:
        shutil.rmtree(FILES_DIR, ignore_errors=True)
        FILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    # 4. Trigger process exit so Docker restarts the container into a clean state
    if reboot_container:
        def restart_worker():
            time.sleep(0.8)
            # Exit process with code 0; Docker restart: unless-stopped will boot fresh
            os._exit(0)

        threading.Thread(target=restart_worker, daemon=True).start()

    return {
        "success": True,
        "shredded_count": shredded_files,
        "message": "All data and databases physically shredded. Container resetting to clean factory state."
    }
