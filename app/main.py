"""
FastAPI Main Application and WebSocket Hub for IronChat.
"""

import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Dict, Set, Optional, Any

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Request,
    Response,
    Depends,
    HTTPException,
    UploadFile,
    File,
    status
)
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.config import (
    ALLOWED_USERS,
    FILES_DIR,
    COOKIE_NAME,
    E2EE_MASTER_PASSPHRASE,
    E2EE_SALT,
    TOTP_INTERVAL,
    HOST,
    PORT,
)
from app.database import (
    init_db,
    get_user,
    activate_user,
    reset_user_totp,
    create_message,
    get_active_messages,
    mark_message_burned,
    save_push_subscription,
    get_user_push_devices,
    delete_push_subscription_by_id,
    delete_all_user_push_subscriptions,
    update_user_activity,
    update_global_interaction,
)
from app.auth import (
    is_valid_username,
    generate_totp_binding,
    verify_totp_code,
    verify_dynamic_password,
    create_session_token,
    verify_session_token,
)
from app.shredder import panic_wipe_all_data, shred_file
from app.deadman import DeadManSwitchDaemon
from app.burn_engine import BurnEngine
from app.push_service import get_or_create_vapid_keys, send_push_notification

# WebSocket Active Connections Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {
            user: set() for user in ALLOWED_USERS
        }

    async def connect(self, username: str, websocket: WebSocket):
        await websocket.accept()
        if username in self.active_connections:
            self.active_connections[username].add(websocket)
        await self.broadcast_presence()

    def disconnect(self, username: str, websocket: WebSocket):
        if username in self.active_connections and websocket in self.active_connections[username]:
            self.active_connections[username].remove(websocket)

    def is_online(self, username: str) -> bool:
        return bool(self.active_connections.get(username))

    async def broadcast(self, payload: dict):
        for user, sockets in self.active_connections.items():
            for ws in list(sockets):
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass

    async def send_to_user(self, username: str, payload: dict):
        if username in self.active_connections:
            for ws in list(self.active_connections[username]):
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass

    async def broadcast_presence(self):
        presence_payload = {
            "type": "presence",
            "users": {
                u: self.is_online(u) for u in ALLOWED_USERS
            }
        }
        await self.broadcast(presence_payload)

manager = ConnectionManager()
burn_engine: Optional[BurnEngine] = None
deadman_daemon: Optional[DeadManSwitchDaemon] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global burn_engine, deadman_daemon
    init_db()
    get_or_create_vapid_keys()

    # Start background engines
    burn_engine = BurnEngine(broadcast_callback=manager.broadcast)
    deadman_daemon = DeadManSwitchDaemon(check_interval_seconds=60)

    burn_task = asyncio.create_task(burn_engine.start())
    deadman_task = asyncio.create_task(deadman_daemon.start())

    yield

    # Cleanup on shutdown
    if burn_engine:
        burn_engine.stop()
    if deadman_daemon:
        deadman_daemon.stop()
    burn_task.cancel()
    deadman_task.cancel()

app = FastAPI(title="IronChat - Ultra-Private Zero-Trust E2EE Messenger", lifespan=lifespan)

# Mount static files and templates
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# Anti-Caching Middleware
@app.middleware("http")
async def add_anti_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Dependency: Get Current Authenticated User
async def get_current_user(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated / 未登录")
    username = verify_session_token(token)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired / 会话已过期")
    return username

# Request Models
class UsernameCheckReq(BaseModel):
    username: str

class TotpBindReq(BaseModel):
    username: str
    secret: str
    code: str

class LoginReq(BaseModel):
    username: str
    password: str

class MessageSendReq(BaseModel):
    ciphertext: str
    iv: str
    msg_type: str
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = 0
    burn_mode: str = "never"
    reply_to_id: Optional[str] = None
    reply_to_sender: Optional[str] = None
    reply_to_text: Optional[str] = None

# ==================== Authentication Endpoints ====================

@app.post("/api/auth/check-username")
async def check_username(req: UsernameCheckReq):
    username = req.username.strip()
    if not is_valid_username(username):
        return JSONResponse(status_code=400, content={"success": False, "message": "Access denied / 非法用户名，拒绝访问"})

    update_global_interaction()
    user = get_user(username)
    if not user:
        return JSONResponse(status_code=404, content={"success": False, "message": "User not found / 用户不存在"})

    if user["is_activated"]:
        return {"success": True, "is_activated": True, "username": username}
    else:
        # Generate new TOTP binding info
        secret, uri, qr_code_url = generate_totp_binding(username)
        return {
            "success": True,
            "is_activated": False,
            "username": username,
            "secret": secret,
            "uri": uri,
            "qr_code": qr_code_url,
            "totp_interval": TOTP_INTERVAL
        }

@app.post("/api/auth/bind-totp")
async def bind_totp(req: TotpBindReq, response: Response):
    username = req.username.strip()
    secret = req.secret.strip()
    code = req.code.strip()

    if not is_valid_username(username):
        return JSONResponse(status_code=400, content={"success": False, "message": "Access denied / 非法用户名"})

    if not verify_totp_code(secret, code):
        return JSONResponse(status_code=400, content={"success": False, "message": "TOTP code incorrect or expired / TOTP 验证码错误或已失效"})

    # Activate user in database
    activate_user(username, secret)
    update_user_activity(username)

    # Issue session cookie
    token = create_session_token(username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False
    )
    return {"success": True, "message": "Activation successful / 绑定成功并已自动登录", "username": username}

@app.post("/api/auth/login")
async def login(req: LoginReq, response: Response):
    username = req.username.strip()
    password = req.password.strip()

    ok, msg = verify_dynamic_password(username, password)
    if not ok:
        return JSONResponse(status_code=401, content={"success": False, "message": msg})

    # Issue session cookie
    token = create_session_token(username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False
    )
    return {"success": True, "message": "Login successful / 登录成功", "username": username}

@app.api_route("/api/auth/logout", methods=["GET", "POST"])
async def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True, samesite="lax")
    response.set_cookie(
        key=COOKIE_NAME,
        value="",
        max_age=0,
        expires=0,
        path="/",
        httponly=True,
        samesite="lax",
        secure=False
    )
    return {"success": True, "message": "Logged out safely / 已安全退出"}

@app.get("/api/me")
async def get_me(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return {"authenticated": False}
    username = verify_session_token(token)
    if not username:
        response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True, samesite="lax")
        response.set_cookie(
            key=COOKIE_NAME,
            value="",
            max_age=0,
            expires=0,
            path="/",
            httponly=True,
            samesite="lax",
            secure=False
        )
        return {"authenticated": False}

    other_user = [u for u in ALLOWED_USERS if u != username][0]
    _, vapid_pub = get_or_create_vapid_keys()
    return {
        "authenticated": True,
        "username": username,
        "peer_username": other_user,
        "peer_online": manager.is_online(other_user),
        "e2ee_passphrase": E2EE_MASTER_PASSPHRASE,
        "e2ee_salt": E2EE_SALT,
        "totp_interval": TOTP_INTERVAL,
        "vapid_public_key": vapid_pub
    }

@app.post("/api/auth/reset-peer-totp")
async def reset_peer_totp_endpoint(user: str = Depends(get_current_user)):
    """
    Allow logged-in user to reset peer's TOTP binding without deleting any chat history.
    """
    peer_user = [u for u in ALLOWED_USERS if u != user][0]
    reset_user_totp(peer_user)
    update_user_activity(user)

    # Disconnect peer user's active websockets immediately
    if peer_user in manager.active_connections:
        for ws in list(manager.active_connections[peer_user]):
            try:
                await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            except Exception:
                pass
        manager.active_connections[peer_user].clear()

    await manager.broadcast({
        "type": "peer_totp_reset",
        "target_user": peer_user,
        "by_user": user,
        "message": f"🔑 {user} reset TOTP binding for {peer_user} (chat history preserved)"
    })
    return {
        "success": True,
        "peer_username": peer_user,
        "message": f"Successfully reset TOTP for {peer_user}. History preserved."
    }

def parse_device_name(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if "iphone" in ua:
        if "safari" not in ua or "mobile/" in ua or "crios" in ua:
            return "iPhone (PWA Home Screen)"
        return "iPhone (Safari)"
    elif "ipad" in ua:
        return "iPad"
    elif "android" in ua:
        if "wv" in ua or "version/" in ua:
            return "Android (PWA App)"
        return "Android (Chrome)"
    elif "macintosh" in ua or "mac os" in ua:
        if "chrome" in ua:
            return "Mac (Chrome)"
        elif "safari" in ua:
            return "Mac (Safari)"
        return "Mac"
    elif "windows" in ua:
        if "edg" in ua:
            return "Windows (Edge)"
        elif "chrome" in ua:
            return "Windows (Chrome)"
        return "Windows PC"
    return "Other Device"

# ==================== Web Push Notification Endpoints ====================

@app.get("/api/push/vapid-public-key")
async def get_vapid_public_key():
    _, pub_key = get_or_create_vapid_keys()
    return {"publicKey": pub_key}

@app.post("/api/push/subscribe")
async def subscribe_push(request: Request, user: str = Depends(get_current_user)):
    sub_data = await request.json()
    endpoint = sub_data.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Invalid PushSubscription")
    ua = request.headers.get("user-agent", "")
    dev_name = parse_device_name(ua)
    client_ip = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for") or (request.client.host if request.client else "-")
    save_push_subscription(user, endpoint, json.dumps(sub_data), device_name=dev_name, user_agent=ua, ip=client_ip)
    return {"success": True, "device_name": dev_name}

@app.get("/api/push/devices")
async def list_push_devices(user: str = Depends(get_current_user)):
    devices = get_user_push_devices(user)
    return {"success": True, "devices": devices}

@app.delete("/api/push/devices/{device_id}")
async def delete_push_device(device_id: str, user: str = Depends(get_current_user)):
    ok = delete_push_subscription_by_id(user, device_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Device not found / 未找到该设备")
    return {"success": True, "message": "Device unlinked / 设备已成功解绑"}

@app.delete("/api/push/devices")
async def delete_all_push_devices(user: str = Depends(get_current_user)):
    count = delete_all_user_push_subscriptions(user)
    return {"success": True, "message": f"Removed {count} devices / 已解绑 {count} 台设备", "count": count}

@app.post("/api/push/test")
async def test_push_notification(user: str = Depends(get_current_user)):
    res = await send_push_notification(
        user,
        title="🔔 IronChat Push Test",
        body=f"Hello {user}! Your device is connected to the secure push channel.",
        tag="ironchat-test"
    )
    return {"success": True, "result": res}

# ==================== Messaging & File Endpoints ====================

@app.get("/api/messages")
async def list_messages(user: str = Depends(get_current_user)):
    messages = get_active_messages()
    return {"success": True, "messages": messages}

@app.post("/api/messages")
async def send_message(req: MessageSendReq, user: str = Depends(get_current_user)):
    msg_id = str(uuid.uuid4())
    now = time.time()

    msg_data = {
        "id": msg_id,
        "sender": user,
        "ciphertext": req.ciphertext,
        "iv": req.iv,
        "msg_type": req.msg_type,
        "file_id": req.file_id,
        "file_name": req.file_name,
        "file_size": req.file_size or 0,
        "burn_mode": req.burn_mode,
        "created_at": now,
        "read_at": None,
        "burn_at": None,
        "reply_to_id": req.reply_to_id,
        "reply_to_sender": req.reply_to_sender,
        "reply_to_text": req.reply_to_text
    }
    create_message(msg_data)

    # Broadcast to all connected clients
    await manager.broadcast({
        "type": "new_message",
        "message": msg_data
    })

    # Trigger background Web Push notification to peer user (Zero content leakage)
    peer_user = [u for u in ALLOWED_USERS if u != user][0]
    asyncio.create_task(
        send_push_notification(
            peer_user,
            title="🔒 IronChat",
            body="You received an encrypted message / 您收到一条端对端加密消息",
            tag=f"ironchat-{msg_id[:8]}"
        )
    )
    return {"success": True, "message": msg_data}

@app.post("/api/messages/{msg_id}/recall")
async def recall_message(msg_id: str, user: str = Depends(get_current_user)):
    """
    Recall (unsend) a message for both users and physically shred any associated attachment.
    """
    update_user_activity(user)
    msg = mark_message_burned(msg_id)
    if not msg:
        return JSONResponse(status_code=404, content={"success": False, "message": "Message not found or already shredded / 消息不存在或已被销毁"})

    file_id = msg.get("file_id")
    if file_id:
        fpath = FILES_DIR / os.path.basename(file_id)
        if fpath.exists():
            shred_file(fpath)

    await manager.broadcast({
        "type": "message_recalled",
        "msg_id": msg_id,
        "recalled_by": user
    })
    return {"success": True, "msg_id": msg_id}

@app.post("/api/messages/{msg_id}/read")
async def read_message(msg_id: str, user: str = Depends(get_current_user)):
    if burn_engine:
        updated = await burn_engine.trigger_read(msg_id, user)
        return {"success": True, "message": updated}
    return {"success": False}

@app.post("/api/files/upload")
async def upload_encrypted_file(file: UploadFile = File(...), user: str = Depends(get_current_user)):
    update_user_activity(user)
    file_id = str(uuid.uuid4()) + "_" + os.path.basename(file.filename or "payload.enc")
    dest_path = FILES_DIR / file_id

    contents = await file.read()
    with open(dest_path, "wb") as f:
        f.write(contents)

    return {
        "success": True,
        "file_id": file_id,
        "file_size": len(contents)
    }

@app.get("/api/files/{file_id}")
async def download_encrypted_file(file_id: str, user: str = Depends(get_current_user)):
    update_user_activity(user)
    safe_name = os.path.basename(file_id)
    target_path = FILES_DIR / safe_name
    if not target_path.is_file():
        raise HTTPException(status_code=404, detail="File does not exist or has been shredded / 文件不存在或已被阅后即焚粉碎")
    return FileResponse(target_path, media_type="application/octet-stream", filename=safe_name)

# ==================== Panic: 删库跑路 / Emergency Wipe ====================

@app.post("/api/panic")
async def panic_button(response: Response, user: str = Depends(get_current_user)):
    """
    [🚨 Panic Destruct / 删库跑路]
    Instantly shred all data, databases, attachments, and trigger container restart!
    """
    # 1. Inform all connected clients to self-destruct immediately
    await manager.broadcast({
        "type": "panic_wipe",
        "operator": user,
        "message": "🚨 Emergency wipe initiated. All data physically shredding!"
    })

    # 2. Clear operator's session cookie
    response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True, samesite="lax")
    response.set_cookie(
        key=COOKIE_NAME,
        value="",
        max_age=0,
        expires=0,
        path="/",
        httponly=True,
        samesite="lax",
        secure=False
    )

    # 3. Disconnect all websocket connections
    for u in list(manager.active_connections.keys()):
        for ws in list(manager.active_connections[u]):
            try:
                await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            except Exception:
                pass
        manager.active_connections[u].clear()

    # 4. Perform physical wipe and reboot container
    result = panic_wipe_all_data(reboot_container=True)
    return result

# ==================== WebSocket Realtime Hub ====================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.cookies.get(COOKIE_NAME)
    username = verify_session_token(token) if token else None

    if not username:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(username, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")

            if event_type == "ping":
                update_user_activity(username)
                await websocket.send_json({"type": "pong", "time": time.time()})

            elif event_type == "typing":
                other_user = [u for u in ALLOWED_USERS if u != username][0]
                await manager.send_to_user(other_user, {
                    "type": "typing",
                    "sender": username,
                    "is_typing": bool(data.get("is_typing", True))
                })

            elif event_type == "read":
                msg_id = data.get("msg_id")
                if msg_id and burn_engine:
                    await burn_engine.trigger_read(msg_id, username)

    except WebSocketDisconnect:
        manager.disconnect(username, websocket)
        await manager.broadcast_presence()
    except Exception:
        manager.disconnect(username, websocket)
        await manager.broadcast_presence()

# ==================== HTML & PWA Entrypoints ====================

@app.api_route("/manifest.json", methods=["GET", "HEAD"])
async def pwa_manifest():
    return FileResponse("app/static/manifest.json", media_type="application/manifest+json")

@app.api_route("/sw.js", methods=["GET", "HEAD"])
async def service_worker():
    return FileResponse(
        "app/static/sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"}
    )

@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
async def favicon():
    return FileResponse("app/static/icons/favicon.ico", media_type="image/png")

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def index_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"version": "1.0.0"}
    )
