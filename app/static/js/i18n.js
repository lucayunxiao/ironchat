/**
 * IronChat Lightweight Zero-Dependency i18n Localization Engine.
 * Supports English (en) and Simplified Chinese (zh-CN).
 */

const I18N_DICTIONARY = {
    "en": {
        "app_title": "IronChat - Ultra-Private Two-Party E2EE Messenger",
        "app_subtitle": "Zero-Knowledge • AES-256-GCM • Ephemeral Self-Destruct",
        "login_badge": "Pair-Only Zero-Trust Access",
        "username_label": "Username",
        "username_placeholder": "Enter username (e.g. alice)",
        "password_label": "Dynamic Password",
        "password_placeholder": "Format: username@TOTP (e.g. alice@123456)",
        "btn_continue": "Next",
        "btn_login": "Sign In",
        "btn_switch_user": "Switch Account",
        "totp_bind_title": "First-Time Setup: Bind Authenticator",
        "totp_bind_tip": "Scan this QR code with your authenticator app (Google Authenticator, Apple Passwords, 1Password, Bitwarden, etc.) or copy the manual key below:",
        "totp_compat_warning": "⚠️ Recommended: Standard 30-second interval. Note: Google Authenticator ignores custom 60s period settings and requires 30s for verification to succeed.",
        "manual_key_label": "Secret Key:",
        "verify_code_placeholder": "Enter 6-digit dynamic code",
        "btn_activate": "Verify & Activate",
        "session_expired": "Session expired or database reset. Please log in again.",
        "online": "Online",
        "offline": "Offline",
        "typing": "is typing...",
        "menu_devices": "Push Devices",
        "menu_reset_peer": "Reset Peer TOTP",
        "menu_panic": "🚨 Panic Destruct",
        "menu_logout": "Sign Out",
        "input_placeholder": "Type an encrypted message, paste image (Ctrl+V), or drag files...",
        "btn_send": "Send",
        "tray_title": "Attachments ready to send",
        "replying_to": "Replying to",
        "cancel_reply": "Cancel",
        "burn_never": "Keep (7d limit)",
        "burn_immediate": "Burn on view",
        "burn_10s": "10s",
        "burn_30s": "30s",
        "burn_1m": "1m",
        "burn_5m": "5m",
        "burn_1h": "1h",
        "burn_24h": "24h",
        "sealed_envelope": "Encrypted Ephemeral Envelope",
        "click_to_open": "Click to decrypt & open",
        "burning_in": "Self-destructing in",
        "seconds": "s",
        "recall_btn": "Recall",
        "reply_btn": "Reply",
        "save_file": "Save / Export",
        "save_video": "Save Video to Album",
        "save_image": "Save Image",
        "panic_title": "🚨 Emergency Data Destruction (Panic)",
        "panic_warn": "WARNING: This will immediately double-pass overwrite and permanently shred ALL databases, messages, attachments, and TOTP keys, rebooting the container into a factory clean state. THIS ACTION CANNOT BE UNDONE!",
        "panic_confirm_prompt": "Type 'SHRED' to confirm:",
        "btn_confirm_panic": "Physically Shred Everything",
        "btn_cancel": "Cancel",
        "reset_peer_confirm": "Are you sure you want to reset peer's TOTP binding? Chat history will be preserved, but they must scan a new QR code upon next login.",
        "device_list_title": "Registered Web Push Devices",
        "no_devices": "No push devices registered yet.",
        "btn_unlink": "Unlink",
        "btn_test_push": "Send Test Push",
        "connecting": "Connecting to encrypted channel...",
        "connected": "E2EE Channel Secure",
        "disconnected": "Disconnected (Reconnecting...)"
    },
    "zh": {
        "app_title": "IronChat - 双人私密端对端加密即时通讯",
        "app_subtitle": "零知识架构 • AES-256-GCM 本地加解密 • 阅后即焚与反取证自毁",
        "login_badge": "严格限定双用户 • 零信任访问",
        "username_label": "用户名",
        "username_placeholder": "输入用户名 (如 alice)",
        "password_label": "动态密码",
        "password_placeholder": "格式：【用户名@TOTP】 (如 alice@123456)",
        "btn_continue": "下一步",
        "btn_login": "登 录",
        "btn_switch_user": "切换账号",
        "totp_bind_title": "首次登录：绑定身份验证器",
        "totp_bind_tip": "请使用手机身份验证器（Google Authenticator、苹果自带密码钥匙串、1Password、Bitwarden等）扫描下方二维码或手动复制密钥：",
        "totp_compat_warning": "⚠️ 强烈推荐：标准 30 秒步长。注意：Google Authenticator 客户端会忽略 60 秒参数，仅支持 30 秒步长正常校验。",
        "manual_key_label": "手动密钥：",
        "verify_code_placeholder": "输入首个 6 位动态验证码",
        "btn_activate": "确认绑定并激活",
        "session_expired": "会话已过期或系统已重置，请重新登录。",
        "online": "在线",
        "offline": "离线",
        "typing": "正在输入...",
        "menu_devices": "已绑推送设备",
        "menu_reset_peer": "重置对方 TOTP",
        "menu_panic": "🚨 删库跑路gogogo",
        "menu_logout": "退出登录",
        "input_placeholder": "输入端对端加密消息，截图可直接 Ctrl+V 粘贴...",
        "btn_send": "发 送",
        "tray_title": "待发送附件托盘",
        "replying_to": "正在回复",
        "cancel_reply": "取消",
        "burn_never": "永久留存 (最长7天)",
        "burn_immediate": "即阅即焚",
        "burn_10s": "10 秒",
        "burn_30s": "30 秒",
        "burn_1m": "1 分钟",
        "burn_5m": "5 分钟",
        "burn_1h": "1 小时",
        "burn_24h": "24 小时",
        "sealed_envelope": "端对端加密保密信封",
        "click_to_open": "点击解密拆开信封",
        "burning_in": "倒计时销毁中",
        "seconds": "秒",
        "recall_btn": "撤回",
        "reply_btn": "回复",
        "save_file": "保存 / 导出",
        "save_video": "保存视频至相册",
        "save_image": "保存原图",
        "panic_title": "🚨 紧急数据物理粉碎与自毁 (删库跑路)",
        "panic_warn": "警告：此操作将立即使用随机数据多遍物理覆写并粉碎所有数据库、聊天记录、多媒体附件与 TOTP 秘钥，并重启容器回到出厂初始状态。此操作绝对不可逆！",
        "panic_confirm_prompt": "请输入 'SHRED' 确认销毁：",
        "btn_confirm_panic": "确认物理粉碎全部数据",
        "btn_cancel": "取 消",
        "reset_peer_confirm": "确定要重置对方用户的 TOTP 验证器绑定状态吗？所有历史聊天记录将被完整保留，但对方下次登录时需重新扫码绑定。",
        "device_list_title": "已绑定的 Web Push 推送设备",
        "no_devices": "暂未绑定任何推送设备。",
        "btn_unlink": "解绑",
        "btn_test_push": "发送测试推送",
        "connecting": "正在连接端对端加密管道...",
        "connected": "E2EE 加密通道安全就绪",
        "disconnected": "网络已断开 (正在尝试重连...)"
    }
};

class IronI18n {
    constructor() {
        this.currentLang = this.detectLanguage();
    }

    detectLanguage() {
        const saved = localStorage.getItem("ironchat_lang");
        if (saved && (saved === "zh" || saved === "en")) {
            return saved;
        }
        const nav = (navigator.language || "").toLowerCase();
        if (nav.startsWith("zh")) {
            return "zh";
        }
        return "en";
    }

    setLanguage(lang) {
        if (lang !== "zh" && lang !== "en") return;
        this.currentLang = lang;
        localStorage.setItem("ironchat_lang", lang);
        this.applyToDOM();
    }

    toggle() {
        const next = this.currentLang === "zh" ? "en" : "zh";
        this.setLanguage(next);
        return next;
    }

    t(key) {
        const langDict = I18N_DICTIONARY[this.currentLang] || I18N_DICTIONARY["en"];
        if (key in langDict) {
            return langDict[key];
        }
        const fallback = I18N_DICTIONARY["en"];
        return fallback[key] || key;
    }

    applyToDOM() {
        document.documentElement.lang = this.currentLang === "zh" ? "zh-CN" : "en";
        
        // Update elements with data-i18n
        document.querySelectorAll("[data-i18n]").forEach(el => {
            const key = el.getAttribute("data-i18n");
            el.textContent = this.t(key);
        });

        // Update elements with data-i18n-placeholder
        document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
            const key = el.getAttribute("data-i18n-placeholder");
            el.setAttribute("placeholder", this.t(key));
        });

        // Update elements with data-i18n-title
        document.querySelectorAll("[data-i18n-title]").forEach(el => {
            const key = el.getAttribute("data-i18n-title");
            el.setAttribute("title", this.t(key));
        });

        // Update language toggle button label
        const langBtn = document.getElementById("langToggleBtn");
        if (langBtn) {
            langBtn.textContent = this.currentLang === "zh" ? "🌐 EN" : "🌐 中文";
        }
    }
}

window.ironI18n = new IronI18n();
