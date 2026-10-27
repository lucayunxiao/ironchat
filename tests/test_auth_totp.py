"""
Tests for IronChat TOTP and Dynamic Authentication.
"""

import pyotp
import pytest
from app.auth import is_valid_username, verify_totp_code, verify_dynamic_password
from app.config import ALLOWED_USERS, TOTP_INTERVAL

def test_allowed_users():
    assert len(ALLOWED_USERS) == 2
    for u in ALLOWED_USERS:
        assert is_valid_username(u)
    assert not is_valid_username("attacker_unknown_user_99")

def test_totp_standard_interval():
    # Verify standard interval is 30 for universal authenticator compatibility
    assert TOTP_INTERVAL == 30

    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret, interval=30)
    current_code = totp.now()

    assert len(current_code) == 6
    assert verify_totp_code(secret, current_code)

def test_dynamic_password_format():
    ok, msg = verify_dynamic_password("invalid_user", "invalid_user@123456")
    assert not ok

    ok2, msg2 = verify_dynamic_password(ALLOWED_USERS[0], "plain_password_without_at")
    assert not ok2
