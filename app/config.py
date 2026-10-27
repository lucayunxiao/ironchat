"""
Configuration module for IronChat (Ultra-Private Zero-Trust E2EE Messenger).
All credentials and personal data are strictly configurable via environment variables.
"""

import json
import os
import secrets
from pathlib import Path

# ----------------- Core User Whitelist (Strict Two-Party) -----------------
USER_A = os.getenv("USER_A", "alice").strip()
USER_B = os.getenv("USER_B", "bob").strip()
ALLOWED_USERS = [USER_A, USER_B]

# ----------------- Security Timers & Thresholds -----------------
# 30 seconds dynamic refresh is the industry standard (RFC 6238) supported by all authenticators.
TOTP_INTERVAL = int(os.getenv("TOTP_INTERVAL", 30))

# User session inactivity logout threshold (24 hours in seconds)
SESSION_INACTIVITY_TIMEOUT = int(os.getenv("SESSION_INACTIVITY_TIMEOUT", 24 * 3600))

# Dead Man's Switch timeout (48 hours in seconds)
# If no activity occurs across the entire system for this period, all data is physically shredded!
DEAD_MAN_TIMEOUT = int(os.getenv("DEAD_MAN_TIMEOUT", 48 * 3600))

# Rolling retention threshold (7 days in seconds)
# Messages and files older than this will be permanently shredded by the background daemon.
MESSAGE_RETENTION_SECONDS = int(os.getenv("MESSAGE_RETENTION_SECONDS", 7 * 24 * 3600))

# ----------------- File and Data Storage Paths -----------------
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "chat.db"
STATE_FILE = DATA_DIR / "state.json"

# Ensure data subdirectories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
FILES_DIR.mkdir(parents=True, exist_ok=True)

# ----------------- Application Credentials & Keys -----------------
APP_DOMAIN = os.getenv("APP_DOMAIN", "localhost")
VAPID_CLAIM_EMAIL = os.getenv("VAPID_CLAIM_EMAIL", "admin@example.com")
E2EE_MASTER_PASSPHRASE = os.getenv("E2EE_MASTER_PASSPHRASE", "IronChat-ZeroKnowledge-MasterPassphrase-2026")
E2EE_SALT = os.getenv("E2EE_SALT", "ironchat-e2ee-salt-standard-2026")
COOKIE_NAME = "ironchat_session"

# Application Secret Key for Session Signing:
# Priority: 1) ENV var SECRET_KEY -> 2) persisted state.json -> 3) auto-generate cryptographically secure token
def _resolve_secret_key() -> str:
    env_key = os.getenv("SECRET_KEY", "").strip()
    if env_key:
        return env_key

    # Check state file
    try:
        if STATE_FILE.exists():
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
                if state.get("secret_key"):
                    return state["secret_key"]
    except Exception:
        pass

    # Generate new random key and save
    generated = secrets.token_hex(32)
    try:
        current_state = {}
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    current_state = json.load(f)
            except Exception:
                current_state = {}
        current_state["secret_key"] = generated
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(current_state, f)
    except Exception:
        pass
    return generated

SECRET_KEY = _resolve_secret_key()

# ----------------- Server Network Binding -----------------
PORT = int(os.getenv("PORT", 8088))
HOST = os.getenv("HOST", "0.0.0.0")
