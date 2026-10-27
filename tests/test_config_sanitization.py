"""
Tests to guarantee zero sensitive information in default configs.
"""

from app.config import ALLOWED_USERS, APP_DOMAIN, VAPID_CLAIM_EMAIL

def test_no_hardcoded_personal_data():
    sensitive_markers = ["lucayunxiao", "ironpeach", "ironluca", "192.168."]
    config_dump = f"{ALLOWED_USERS} {APP_DOMAIN} {VAPID_CLAIM_EMAIL}".lower()
    for marker in sensitive_markers:
        assert marker not in config_dump, f"Found sensitive marker in config: {marker}"
