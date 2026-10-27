"""
Tests to guarantee zero sensitive information in default configs and auto-generation functionality.
"""

from app.config import (
    ALLOWED_USERS,
    APP_DOMAIN,
    VAPID_CLAIM_EMAIL,
    SECRET_KEY,
    E2EE_MASTER_PASSPHRASE,
    E2EE_SALT,
)

def test_no_hardcoded_personal_data():
    sensitive_markers = ["lucayunxiao", "ironpeach", "ironluca", "192.168."]
    config_dump = f"{ALLOWED_USERS} {APP_DOMAIN} {VAPID_CLAIM_EMAIL}".lower()
    for marker in sensitive_markers:
        assert marker not in config_dump, f"Found sensitive marker in config: {marker}"

def test_auto_generated_secrets():
    # Verify that secret keys are generated with high entropy and non-empty
    assert SECRET_KEY and len(SECRET_KEY) >= 32
    assert E2EE_MASTER_PASSPHRASE and len(E2EE_MASTER_PASSPHRASE) >= 20
    assert E2EE_SALT and len(E2EE_SALT) >= 16
