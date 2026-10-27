"""
Authentication and TOTP Dynamic Password module for IronChat.
Enforces strict pair whitelist and tamper-proof session signatures.
"""

import base64
import hashlib
import hmac
import io
import json
import time
from typing import Optional, Tuple
import pyotp
import qrcode

from app.config import (
    ALLOWED_USERS,
    TOTP_INTERVAL,
    SESSION_INACTIVITY_TIMEOUT,
    SECRET_KEY,
)
from app.database import get_user, update_user_activity

def is_valid_username(username: str) -> bool:
    """Ensure username is one of the strictly allowed users."""
    return username.strip() in ALLOWED_USERS

def generate_totp_binding(username: str) -> Tuple[str, str, str]:
    """
    Generate a new TOTP secret and QR code for initial binding.
    Returns: (secret_base32, provisioning_uri, qr_code_base64_data_url)
    """
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret, interval=TOTP_INTERVAL)
    uri = totp.provisioning_uri(name=username, issuer_name="IronChat")

    # Generate QR Code PNG and encode to Base64
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=3,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0f172a", back_color="#ffffff")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_qr = base64.b64encode(buf.getvalue()).decode("utf-8")
    data_url = f"data:image/png;base64,{b64_qr}"

    return secret, uri, data_url

def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against a secret with configured interval."""
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret, interval=TOTP_INTERVAL)
    # valid_window=1 allows current interval and previous/next (+/- interval) for clock drift tolerance
    return totp.verify(code.strip(), valid_window=1)

def verify_dynamic_password(username: str, password_input: str) -> Tuple[bool, str]:
    """
    Verify password matching rule: 【用户名@TOTP】 (e.g. alice@123456).
    Returns: (is_success, error_or_success_message)
    """
    if not is_valid_username(username):
        return False, "Invalid username. Access denied / 非法用户名，拒绝访问"

    if "@" not in password_input:
        return False, "Password format error. Expected [username@TOTP] / 密码格式错误，必须为【用户名@TOTP】"

    parts = password_input.strip().rsplit("@", 1)
    if len(parts) != 2:
        return False, "Password format error. Expected [username@TOTP] / 密码格式错误，必须为【用户名@TOTP】"

    input_user, code = parts[0], parts[1]
    if input_user != username:
        return False, "Username in dynamic password does not match current user / 动态密码中的用户名与当前用户不一致"

    user_record = get_user(username)
    if not user_record:
        return False, "User not initialized / 用户未初始化"

    if not user_record["is_activated"] or not user_record["totp_secret"]:
        return False, "User has not bound TOTP yet. Please complete initial setup / 用户尚未绑定 TOTP，请先完成初始绑定"

    if verify_totp_code(user_record["totp_secret"], code):
        update_user_activity(username)
        return True, "Authentication successful / 认证成功"
    else:
        return False, "TOTP dynamic code invalid or expired / 动态验证码错误或已过期（请检查身份验证器动态码）"

def create_session_token(username: str) -> str:
    """Create a signed tamper-proof session token."""
    now = time.time()
    payload = {
        "u": username,
        "iat": now,
        "act": now
    }
    raw_json = json.dumps(payload, separators=(',', ':')).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_json).decode("utf-8")
    signature = hmac.new(SECRET_KEY.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{signature}"

def verify_session_token(token: str) -> Optional[str]:
    """
    Verify session token signature and 24-hour inactivity timeout.
    Returns: username if valid, None if invalid or expired.
    """
    if not token or "." not in token:
        return None

    try:
        b64_payload, signature = token.split(".", 1)
        expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None

        raw_json = base64.urlsafe_b64decode(b64_payload.encode("utf-8"))
        payload = json.loads(raw_json.decode("utf-8"))
        username = payload.get("u")
        last_active = payload.get("act", 0)

        if not username or username not in ALLOWED_USERS:
            return None

        # Check 24-hour inactivity timeout
        now = time.time()
        if now - last_active > SESSION_INACTIVITY_TIMEOUT:
            return None

        # Check if user exists and is activated in database
        # If database was wiped (panic wipe), invalidate session immediately!
        user_record = get_user(username)
        if not user_record or not user_record.get("is_activated") or not user_record.get("totp_secret"):
            return None

        update_user_activity(username)
        return username
    except Exception:
        return None
