"""
Configuration module for IronChat (Ultra-Private Zero-Trust E2EE Messenger).
All credentials and personal data are strictly configurable via environment variables.
Supports automatic cryptographically secure key generation when credentials are left empty.
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
COOKIE_NAME = "ironchat_session"

# Helper functions to load, persist, and resolve stateful cryptographic secrets
def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_state(state: dict) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass

def _resolve_or_generate(env_var_name: str, state_key: str, generator_fn) -> str:
    """
    Priority:
    1. Value set in environment variable (and non-empty)
    2. Value previously generated and saved in data/state.json
    3. Generate a new cryptographically secure token and persist it
    """
    env_val = os.getenv(env_var_name, "").strip()
    if env_val:
        return env_val

    state = _load_state()
    if state.get(state_key):
        return state[state_key]

    generated = generator_fn()
    state[state_key] = generated
    _save_state(state)
    return generated

# 1. HTTP Session Signing Key (64-character hex token if left empty)
SECRET_KEY = _resolve_or_generate(
    "SECRET_KEY",
    "secret_key",
    lambda: secrets.token_hex(32)
)

# 2. E2EE Master Passphrase Seed (High-entropy URL-safe token if left empty)
E2EE_MASTER_PASSPHRASE = _resolve_or_generate(
    "E2EE_MASTER_PASSPHRASE",
    "e2ee_passphrase",
    lambda: secrets.token_urlsafe(32)
)

# 3. E2EE Salt for PBKDF2 (32-character hex token if left empty)
E2EE_SALT = _resolve_or_generate(
    "E2EE_SALT",
    "e2ee_salt",
    lambda: secrets.token_hex(16)
)

# ----------------- Server Network Binding -----------------
PORT = int(os.getenv("PORT", 8088))
HOST = os.getenv("HOST", "0.0.0.0")
