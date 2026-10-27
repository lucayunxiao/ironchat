"""
Web Push (RFC 8030 / RFC 8292 VAPID) Notification Service for IronChat.
Supports iOS 16.4+ Home Screen Web Apps (APNs), Android/Desktop Chrome/Edge (FCM/WNS), and macOS Safari.
"""

import asyncio
import base64
import json
import logging
from typing import Tuple, Dict, Any
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from pywebpush import webpush, WebPushException

from app.config import VAPID_CLAIM_EMAIL
from app.database import (
    get_system_state,
    set_system_state,
    get_user_push_subscriptions,
    delete_push_subscription,
)

logger = logging.getLogger("PushService")

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def get_or_create_vapid_keys() -> Tuple[str, str]:
    """
    Retrieve or generate VAPID (private_key_b64url, public_key_b64url) stored in SQLite system_state.
    """
    priv_b64 = get_system_state("vapid_private_key")
    pub_b64 = get_system_state("vapid_public_key")
    if priv_b64 and pub_b64:
        return priv_b64, pub_b64

    # Generate new ECDSA P-256 keypair
    private_key = ec.generate_private_key(ec.SECP256R1())
    priv_numbers = private_key.private_numbers()
    priv_bytes = priv_numbers.private_value.to_bytes(32, byteorder="big")
    priv_b64 = _b64url_encode(priv_bytes)

    pub_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = _b64url_encode(pub_bytes)

    set_system_state("vapid_private_key", priv_b64)
    set_system_state("vapid_public_key", pub_b64)
    logger.info("Generated new VAPID P-256 keypair for Web Push.")
    return priv_b64, pub_b64

def _send_single_push_sync(sub_info: Dict[str, Any], payload_str: str, priv_key: str) -> str:
    """Synchronous worker to dispatch a single Web Push message."""
    endpoint = sub_info.get("endpoint", "")
    try:
        webpush(
            subscription_info=sub_info,
            data=payload_str,
            vapid_private_key=priv_key,
            vapid_claims={"sub": f"mailto:{VAPID_CLAIM_EMAIL}"},
            ttl=86400,
            headers={"Urgency": "high", "Topic": "ironchat-msg"},
        )
        return "ok"
    except WebPushException as ex:
        if ex.response is not None and ex.response.status_code in (404, 410):
            delete_push_subscription(endpoint)
            return "expired"
        logger.warning(f"WebPush error for {endpoint[:40]}...: {ex}")
        return f"error: {ex}"
    except Exception as e:
        logger.warning(f"Unexpected push error: {e}")
        return f"error: {e}"

async def send_push_notification(username: str, title: str, body: str, tag: str = "ironchat-msg") -> Dict[str, int]:
    """
    Send standard Web Push notification to all subscribed devices of `username`.
    """
    subs = get_user_push_subscriptions(username)
    if not subs:
        return {"sent": 0, "total": 0}

    priv_key, _ = get_or_create_vapid_keys()
    payload_str = json.dumps({
        "title": title,
        "body": body,
        "tag": tag,
        "url": "/",
        "timestamp": int(asyncio.get_event_loop().time() * 1000)
    })

    sent_count = 0
    for row in subs:
        try:
            sub_info = json.loads(row["subscription_json"])
            res = await asyncio.to_thread(_send_single_push_sync, sub_info, payload_str, priv_key)
            if res == "ok":
                sent_count += 1
        except Exception as e:
            logger.warning(f"Failed processing push row: {e}")

    return {"sent": sent_count, "total": len(subs)}
