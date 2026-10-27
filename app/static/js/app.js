/**
 * app.js - IronChat Frontend Application Controller
 * Features:
 * 1. Dynamic 60s TOTP Auth & Peer TOTP Reset (preserving chat history)
 * 2. Silent WebCrypto AES-256-GCM E2EE for text and all file types
 * 3. Real-time Read Receipts (Unread / Read)
 * 4. Click-to-View Burn-After-Reading Envelope (repeatable view within countdown, dual-side wipe on expiry)
 * 5. Bidirectional Message Recall (Unsend for both sides)
 * 6. Zero-Content-Leakage Cross-Platform Web Push (VAPID / APNs / FCM) + Service Worker + WebAudio Chime
 * 7. Mobile & Desktop PWA Standalone Support
 */

document.addEventListener('DOMContentLoaded', async () => {
    // State
    let currentUser = null;
    let peerUser = null;
    let vapidPublicKey = null;
    let ws = null;
    let pingInterval = null;
    let typingTimer = null;
    let pendingTotpSecret = null;
    let pendingUsername = null;
    let swRegistration = null;
    let deferredInstallPrompt = null;
    let currentViewingBurnMsgId = null;
    let burnViewerInterval = null;
    let activeReplyMsg = null;
    let stagedAttachments = [];
    const messageStore = new Map();
    const messagePlainCache = new Map();
    const pendingUnreadIds = new Set();

    // DOM Elements
    const replyBar = document.getElementById('replyBar');
    const replyBarSender = document.getElementById('replyBarSender');
    const replyBarSnippet = document.getElementById('replyBarSnippet');
    const btnCancelReply = document.getElementById('btnCancelReply');
    const attachmentTray = document.getElementById('attachmentTray');

    const authModal = document.getElementById('authModal');
    const authStepUsername = document.getElementById('authStepUsername');
    const authStepBind = document.getElementById('authStepBind');
    const authStepLogin = document.getElementById('authStepLogin');
    const inputUsername = document.getElementById('inputUsername');
    const btnCheckUsername = document.getElementById('btnCheckUsername');
    const totpQrImg = document.getElementById('totpQrImg');
    const totpSecretText = document.getElementById('totpSecretText');
    const inputBindCode = document.getElementById('inputBindCode');
    const btnConfirmBind = document.getElementById('btnConfirmBind');
    const inputDynamicPassword = document.getElementById('inputDynamicPassword');
    const btnDoLogin = document.getElementById('btnDoLogin');

    const btnNotifyPwa = document.getElementById('btnNotifyPwa');
    const iconNotifyBell = document.getElementById('iconNotifyBell');
    const notifyPwaModal = document.getElementById('notifyPwaModal');
    const notifyStatusDesc = document.getElementById('notifyStatusDesc');
    const btnEnablePush = document.getElementById('btnEnablePush');
    const btnTestPush = document.getElementById('btnTestPush');
    const btnInstallPwa = document.getElementById('btnInstallPwa');
    const btnCloseNotifyPwa = document.getElementById('btnCloseNotifyPwa');
    const pushDeviceList = document.getElementById('pushDeviceList');
    const pushDeviceCount = document.getElementById('pushDeviceCount');
    const btnRefreshDevices = document.getElementById('btnRefreshDevices');
    const btnClearAllDevices = document.getElementById('btnClearAllDevices');

    const btnResetPeerTotp = document.getElementById('btnResetPeerTotp');
    const panicModal = document.getElementById('panicModal');
    const btnPanic = document.getElementById('btnPanic');
    const inputPanicConfirm = document.getElementById('inputPanicConfirm');
    const btnCancelPanic = document.getElementById('btnCancelPanic');
    const btnExecutePanic = document.getElementById('btnExecutePanic');
    const btnLogout = document.getElementById('btnLogout');

    const headerPeerName = document.getElementById('headerPeerName');
    const peerStatusDot = document.getElementById('peerStatusDot');
    const peerStatusText = document.getElementById('peerStatusText');
    const typingIndicator = document.getElementById('typingIndicator');
    const messagesContainer = document.getElementById('messagesContainer');
    const chatEmptyState = document.getElementById('chatEmptyState');
    const chatInput = document.getElementById('chatInput');
    const btnSend = document.getElementById('btnSend');
    const btnAttach = document.getElementById('btnAttach');
    const fileInput = document.getElementById('fileInput');
    const burnModeSelect = document.getElementById('burnModeSelect');
    const lightboxModal = document.getElementById('lightboxModal');
    const lightboxImg = document.getElementById('lightboxImg');
    const btnLightboxDownload = document.getElementById('btnLightboxDownload');
    let activeLightboxBlob = null;
    let activeLightboxFileName = 'image.jpg';

    if (btnLightboxDownload) {
        btnLightboxDownload.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (activeLightboxBlob) {
                btnLightboxDownload.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>保存中...</span>`;
                try {
                    await triggerFileDownload(activeLightboxBlob, activeLightboxFileName);
                } finally {
                    btnLightboxDownload.innerHTML = `<i class="fa-solid fa-arrow-down-to-line"></i> <span>保存图片</span>`;
                }
            }
        });
    }

    const burnViewerModal = document.getElementById('burnViewerModal');
    const burnViewerTimerBadge = document.getElementById('burnViewerTimerBadge');
    const burnViewerBody = document.getElementById('burnViewerBody');
    const btnCloseBurnViewer = document.getElementById('btnCloseBurnViewer');

    // ==================== 0. PWA Service Worker & Install Prompt ====================
    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch (e) {
            console.warn('ServiceWorker registration warning:', e);
        }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
    });

    function isStandalonePwa() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function isIosDevice() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    // iOS Standalone PWA & Soft Keyboard Dynamic Viewport Adaptation
    function syncAppHeight() {
        const vv = window.visualViewport;
        const baseH = document.documentElement.clientHeight || window.innerHeight;
        if (vv && (baseH - vv.height > 80)) {
            document.body.classList.add('keyboard-open');
            document.body.style.height = `${vv.height}px`;
            window.scrollTo(0, 0);
            setTimeout(scrollToBottom, 50);
        } else {
            document.body.classList.remove('keyboard-open');
            document.body.style.height = '100%';
            window.scrollTo(0, 0);
        }
    }
    syncAppHeight();
    window.addEventListener('resize', syncAppHeight);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncAppHeight);
        window.visualViewport.addEventListener('scroll', syncAppHeight);
    }

    // ==================== 1. Init & Auth Check ====================
    async function checkAuth() {
        try {
            const res = await fetch('/api/me');
            const data = await res.json();
            if (data.authenticated) {
                currentUser = data.username;
                peerUser = data.peer_username;
                vapidPublicKey = data.vapid_public_key || null;
                headerPeerName.textContent = peerUser;
                updatePeerPresence(data.peer_online);

                if (data.e2ee_passphrase) {
                    await ironCrypto.setPassphrase(data.e2ee_passphrase, true);
                } else {
                    await ironCrypto.tryRestoreKey();
                }

                startChatSession();
                updateNotifyBadgeStatus();

                if ('Notification' in window && Notification.permission === 'granted') {
                    syncWebPushSubscription(false);
                }
            } else {
                showAuthModal();
            }
        } catch {
            showAuthModal();
        }
    }

    function showAuthModal() {
        authModal.style.display = 'flex';
        authStepUsername.style.display = 'block';
        authStepBind.style.display = 'none';
        authStepLogin.style.display = 'none';
        inputUsername.value = '';
        setTimeout(() => inputUsername.focus(), 100);
    }

    // Step 1: Check Username
    btnCheckUsername.addEventListener('click', async () => {
        const u = inputUsername.value.trim().toLowerCase();
        if (!u) {
            alert('请输入用户名');
            return;
        }
        btnCheckUsername.disabled = true;
        btnCheckUsername.textContent = '检测中...';

        try {
            const res = await fetch('/api/auth/check-username', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u })
            });
            const data = await res.json();
            btnCheckUsername.disabled = false;
            btnCheckUsername.textContent = '下一步';

            if (!res.ok || !data.success) {
                alert(data.message || '用户名无效');
                return;
            }

            pendingUsername = u;
            authStepUsername.style.display = 'none';

            if (data.is_activated) {
                authStepLogin.style.display = 'block';
                inputDynamicPassword.value = '';
                inputDynamicPassword.placeholder = `例如: ${u}@123456`;
                setTimeout(() => inputDynamicPassword.focus(), 100);
            } else {
                authStepBind.style.display = 'block';
                pendingTotpSecret = data.secret;
                totpQrImg.src = data.qr_code;
                totpSecretText.textContent = `密钥 Code: ${data.secret}`;
                inputBindCode.value = '';
                setTimeout(() => inputBindCode.focus(), 100);
            }
        } catch (e) {
            btnCheckUsername.disabled = false;
            btnCheckUsername.textContent = '下一步';
            alert(`网络请求异常: ${e.message}`);
        }
    });

    totpSecretText.addEventListener('click', () => {
        if (pendingTotpSecret && navigator.clipboard) {
            navigator.clipboard.writeText(pendingTotpSecret);
            totpSecretText.textContent = `✅ 已复制密钥: ${pendingTotpSecret}`;
        }
    });

    // Step 2A: Confirm TOTP Bind
    btnConfirmBind.addEventListener('click', async () => {
        const code = inputBindCode.value.trim();
        if (code.length !== 6) {
            alert('请输入验证器中生成的 6 位有效数字验证码');
            return;
        }
        btnConfirmBind.disabled = true;
        btnConfirmBind.textContent = '正在激活绑定...';

        try {
            const res = await fetch('/api/auth/bind-totp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: pendingUsername,
                    secret: pendingTotpSecret,
                    code: code
                })
            });
            const data = await res.json();
            btnConfirmBind.disabled = false;
            btnConfirmBind.textContent = '确认绑定并登录';

            if (res.ok && data.success) {
                authModal.style.display = 'none';
                checkAuth();
            } else {
                alert(data.message || '绑定失败，请检查验证码');
            }
        } catch (e) {
            btnConfirmBind.disabled = false;
            btnConfirmBind.textContent = '确认绑定并登录';
            alert(`网络异常: ${e.message}`);
        }
    });

    // Step 2B: Dynamic Password Login 【用户名@TOTP】
    btnDoLogin.addEventListener('click', async () => {
        const pwd = inputDynamicPassword.value.trim();
        if (!pwd) {
            alert('请输入动态密码【用户名@TOTP】');
            return;
        }
        btnDoLogin.disabled = true;
        btnDoLogin.textContent = '正在验证...';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: pendingUsername,
                    password: pwd
                })
            });
            const data = await res.json();
            btnDoLogin.disabled = false;
            btnDoLogin.textContent = '验证登录';

            if (res.ok && data.success) {
                authModal.style.display = 'none';
                checkAuth();
            } else {
                alert(data.message || '认证失败，请检查 30 秒 TOTP 动态码');
            }
        } catch (e) {
            btnDoLogin.disabled = false;
            btnDoLogin.textContent = '验证登录';
            alert(`网络异常: ${e.message}`);
        }
    });

    inputUsername.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnCheckUsername.click();
    });
    inputBindCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnConfirmBind.click();
    });
    inputDynamicPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnDoLogin.click();
    });

    // ==================== 2. Reset Peer TOTP & Logout ====================
    btnResetPeerTotp.addEventListener('click', async () => {
        const target = peerUser || '对方账号';
        const ok = confirm(
            `🔑 确认要为对方【${target}】重置 TOTP 身份验证器吗？\n\n` +
            `• 所有聊天记录与加密文件将 100% 完好保留\n` +
            `• 重置后，${target} 在登录界面输入用户名即可直接获取新二维码重新扫码绑定`
        );
        if (!ok) return;

        try {
            const res = await fetch('/api/auth/reset-peer-totp', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                alert(`✅ ${data.message}`);
            } else {
                alert(data.message || '重置失败');
            }
        } catch (e) {
            alert(`请求失败: ${e.message}`);
        }
    });

    btnLogout.addEventListener('click', async () => {
        if (!confirm('确认退出当前账号登录吗？')) return;
        btnLogout.style.opacity = '0.5';
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch {}
        if (ws) {
            try { ws.close(); } catch {}
        }
        ironCrypto.clearKey();
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {}
        currentUser = null;
        peerUser = null;
        document.cookie = "ironchat_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        location.href = '/?logout=' + Date.now();
    });

    // ==================== 3. Cross-Platform Notifications & PWA (Zero Content Leakage) ====================
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    function playNotificationChime() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const now = ctx.currentTime;

            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, now);
            osc1.frequency.setValueAtTime(880, now + 0.11);
            gain1.gain.setValueAtTime(0.15, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.35);
        } catch {}
    }

    function updateNotifyBadgeStatus() {
        const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
        if (perm === 'granted') {
            iconNotifyBell.style.color = '#34d399';
        } else {
            iconNotifyBell.style.color = '#fbbf24';
        }

        const pwaMode = isStandalonePwa() ? '✅ 已作为独立 PWA 应用运行' : '🌐 浏览器网页模式（支持安装到主屏幕）';
        let permText = '未开启（点击下方按钮一键授权）';
        if (perm === 'granted') permText = '✅ 已授权激活（锁屏/通知栏绝不泄露任何消息内容）';
        else if (perm === 'denied') permText = '⚠️ 已被浏览器拦截（请在系统/浏览器设置中允许通知）';
        else if (perm === 'unsupported') {
            permText = isIosDevice()
                ? '📱 iOS 设备请先点击底部分享【添加到主屏幕】，从桌面图标打开即可开启苹果 APNs 推送'
                : '当前环境仅支持前台应用内声音与震动提醒';
        }

        notifyStatusDesc.innerHTML =
            `<strong>当前运行模式：</strong>${pwaMode}<br>` +
            `<strong>系统推送状态：</strong>${permText}`;
    }

    async function syncWebPushSubscription(interactive = true) {
        if (!('Notification' in window)) {
            if (interactive) {
                alert(
                    isIosDevice()
                        ? '📱 iOS Safari 规定：请先点击浏览器底部【分享】->【添加到主屏幕】，然后从桌面打开 IronChat 图标，即可授权开启苹果 APNs 原生系统通知！'
                        : '当前浏览器不支持系统通知 API，已自动为您启用应用内声音与标题闪烁提醒。'
                );
            }
            return false;
        }

        let perm = Notification.permission;
        if (perm !== 'granted') {
            perm = await Notification.requestPermission();
        }
        updateNotifyBadgeStatus();

        if (perm !== 'granted') {
            if (interactive) alert('未授予通知权限，请在浏览器或系统设置中允许通知。');
            return false;
        }

        try {
            if (!swRegistration && 'serviceWorker' in navigator) {
                swRegistration = await navigator.serviceWorker.ready;
            }
            if (swRegistration && swRegistration.pushManager) {
                if (!vapidPublicKey) {
                    const r = await fetch('/api/push/vapid-public-key');
                    const d = await r.json();
                    vapidPublicKey = d.publicKey;
                }
                let sub = await swRegistration.pushManager.getSubscription();
                if (!sub && vapidPublicKey) {
                    sub = await swRegistration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
                    });
                }
                if (sub) {
                    await fetch('/api/push/subscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(sub.toJSON())
                    });
                }
            }
            if (interactive) {
                playNotificationChime();
                alert('✅ 系统级消息推送通道 (Web Push) 已成功绑定激活！');
            }
            loadPushDevices();
            return true;
        } catch (e) {
            console.warn('WebPush subscription error:', e);
            if (interactive) {
                alert(`✅ 浏览器通知权限已开启（Web Push 通道提示: ${e.message}）`);
            }
            return true;
        }
    }

    function triggerIncomingNotification(msgId) {
        playNotificationChime();
        if (navigator.vibrate) {
            try { navigator.vibrate([120, 60, 120]); } catch {}
        }

        if (document.hidden || !document.hasFocus()) {
            document.title = `🔴 [新消息] IronChat`;
            if ('Notification' in window && Notification.permission === 'granted') {
                const tag = `ironchat-${(msgId || '').slice(0, 8)}`;
                const notifTitle = '🔒 IronChat 新消息';
                const notifBody = '您收到一条端对端加密消息，请点击进入应用查看';

                if (swRegistration && swRegistration.showNotification) {
                    swRegistration.showNotification(notifTitle, {
                        body: notifBody,
                        icon: '/static/icons/icon-192.png',
                        badge: '/static/icons/icon-192.png',
                        tag: tag,
                        renotify: true
                    }).catch(() => {});
                } else {
                    try {
                        new Notification(notifTitle, {
                            body: notifBody,
                            icon: '/static/icons/icon-192.png',
                            tag: tag
                        });
                    } catch {}
                }
            }
        }
    }

    async function loadPushDevices() {
        if (!pushDeviceList) return;
        pushDeviceList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 12px;"><i class="fa-solid fa-spinner fa-spin"></i> 正在加载设备列表...</div>`;
        try {
            const res = await fetch('/api/push/devices');
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.detail || '加载失败');

            const devices = data.devices || [];
            if (pushDeviceCount) pushDeviceCount.textContent = devices.length;

            if (btnClearAllDevices) {
                btnClearAllDevices.style.display = devices.length > 0 ? 'block' : 'none';
            }

            if (devices.length === 0) {
                pushDeviceList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 12px;">暂无已绑定的推送设备</div>`;
                return;
            }

            let curEndpoint = '';
            if (swRegistration && swRegistration.pushManager) {
                try {
                    const sub = await swRegistration.pushManager.getSubscription();
                    if (sub) curEndpoint = sub.endpoint || '';
                } catch {}
            }

            pushDeviceList.innerHTML = '';
            for (const dev of devices) {
                const card = document.createElement('div');
                card.className = 'device-card';

                const isCurrent = curEndpoint && (curEndpoint.includes(dev.id) || (dev.endpoint_preview && dev.endpoint_preview.includes(curEndpoint.slice(-15))));
                const isMobile = /iPhone|iPad|Android|Mobile/i.test(dev.device_name);
                const devIcon = isMobile ? 'fa-mobile-screen-button' : 'fa-laptop';

                card.innerHTML = `
                    <div class="device-info">
                        <div class="device-name">
                            <i class="fa-solid ${devIcon}" style="color: ${isMobile ? '#34d399' : '#60a5fa'};"></i>
                            <span>${escapeHtml(dev.device_name)}</span>
                            ${isCurrent ? '<span class="device-badge-current">当前设备</span>' : ''}
                        </div>
                        <div class="device-meta">
                            <span>IP: ${escapeHtml(dev.ip)}</span> · <span>${escapeHtml(dev.created_at_fmt)}</span>
                        </div>
                    </div>
                    <button type="button" class="btn-remove-device" title="解绑并移除此推送设备">
                        <i class="fa-solid fa-trash-can"></i> 移除
                    </button>
                `;

                const btnRemove = card.querySelector('.btn-remove-device');
                btnRemove.onclick = async () => {
                    if (!confirm(`确认解绑移除推送设备【${dev.device_name}】吗？\n移除后该设备将不再接收消息推送。`)) return;
                    btnRemove.disabled = true;
                    btnRemove.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
                    try {
                        const delRes = await fetch(`/api/push/devices/${dev.id}`, { method: 'DELETE' });
                        const delData = await delRes.json();
                        if (delRes.ok && delData.success) {
                            if (isCurrent && swRegistration && swRegistration.pushManager) {
                                try {
                                    const sub = await swRegistration.pushManager.getSubscription();
                                    if (sub) await sub.unsubscribe();
                                } catch {}
                            }
                            await loadPushDevices();
                            updateNotifyBadgeStatus();
                        } else {
                            alert(delData.detail || '移除失败');
                        }
                    } catch (e) {
                        alert(`移除异常: ${e.message}`);
                    }
                };

                pushDeviceList.appendChild(card);
            }
        } catch (err) {
            pushDeviceList.innerHTML = `<div style="text-align: center; color: #f87171; font-size: 12px; padding: 12px;">加载失败: ${escapeHtml(err.message)}</div>`;
        }
    }

    if (btnRefreshDevices) {
        btnRefreshDevices.addEventListener('click', () => loadPushDevices());
    }

    if (btnClearAllDevices) {
        btnClearAllDevices.addEventListener('click', async () => {
            if (!confirm('确认要解绑并清空当前账号绑定的所有推送设备吗？')) return;
            btnClearAllDevices.disabled = true;
            try {
                const r = await fetch('/api/push/devices', { method: 'DELETE' });
                const d = await r.json();
                if (r.ok && d.success) {
                    if (swRegistration && swRegistration.pushManager) {
                        try {
                            const sub = await swRegistration.pushManager.getSubscription();
                            if (sub) await sub.unsubscribe();
                        } catch {}
                    }
                    alert(`✅ ${d.message}`);
                    await loadPushDevices();
                    updateNotifyBadgeStatus();
                } else {
                    alert(d.detail || '清空失败');
                }
            } catch (e) {
                alert(`清空异常: ${e.message}`);
            } finally {
                btnClearAllDevices.disabled = false;
            }
        });
    }

    btnNotifyPwa.addEventListener('click', () => {
        updateNotifyBadgeStatus();
        loadPushDevices();
        notifyPwaModal.style.display = 'flex';
    });

    btnCloseNotifyPwa.addEventListener('click', () => {
        notifyPwaModal.style.display = 'none';
    });

    btnEnablePush.addEventListener('click', async () => {
        btnEnablePush.disabled = true;
        await syncWebPushSubscription(true);
        btnEnablePush.disabled = false;
    });

    btnTestPush.addEventListener('click', async () => {
        playNotificationChime();
        await syncWebPushSubscription(false);
        try {
            const res = await fetch('/api/push/test', { method: 'POST' });
            const data = await res.json();
            if ('Notification' in window && Notification.permission === 'granted' && swRegistration) {
                swRegistration.showNotification('🔔 IronChat 本地+云端双通道测试', {
                    body: '通知通道工作正常（实际新消息通知不会显示任何消息内容）。',
                    icon: '/static/icons/icon-192.png',
                    tag: 'ironchat-test'
                }).catch(() => {});
            }
            const sentCount = (data.result && data.result.sent) || 0;
            alert(`✅ 测试通知已触发！\n• 云端 Web Push 投递设备数: ${sentCount}\n• 本地声音与系统通知已同步响起`);
        } catch (e) {
            alert(`测试通知异常: ${e.message}`);
        }
    });

    btnInstallPwa.addEventListener('click', async () => {
        if (isStandalonePwa()) {
            alert('✅ 当前已经作为独立 PWA 手机应用运行中！');
            return;
        }
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            updateNotifyBadgeStatus();
        } else if (isIosDevice()) {
            alert('📱 iPhone / iPad 安装步骤：\n1. 点击 Safari 底部中间的【分享】图标\n2. 向下滑动菜单，点击【添加到主屏幕】\n3. 点击右上角【添加】，即可在桌面生成 IronChat 独立 App！');
        } else {
            alert('📲 请点击浏览器右上角菜单（⋮ 或地址栏右侧安装图标）-> 选择【安装应用】或【添加到主屏幕】。');
        }
    });

    // ==================== 4. Realtime WebSocket Hub ====================
    function startChatSession() {
        connectWebSocket();
        loadHistoryMessages();
    }

    function connectWebSocket() {
        if (ws) {
            try { ws.close(); } catch {}
        }
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            if (pingInterval) clearInterval(pingInterval);
            pingInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 20000);
        };

        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWsEvent(data);
            } catch {}
        };

        ws.onclose = () => {
            if (pingInterval) clearInterval(pingInterval);
            setTimeout(() => {
                if (currentUser && ironCrypto.hasKey()) {
                    connectWebSocket();
                }
            }, 3000);
        };
    }

    async function handleWsEvent(data) {
        switch (data.type) {
            case 'presence':
                if (peerUser && data.users) {
                    updatePeerPresence(data.users[peerUser]);
                }
                break;

            case 'typing':
                if (data.sender === peerUser) {
                    typingIndicator.style.display = data.is_typing ? 'inline-block' : 'none';
                    if (data.is_typing) {
                        clearTimeout(typingTimer);
                        typingTimer = setTimeout(() => {
                            typingIndicator.style.display = 'none';
                        }, 3000);
                    }
                }
                break;

            case 'new_message':
                await renderMessageBubble(data.message);
                scrollToBottom();
                if (data.message.sender !== currentUser) {
                    triggerIncomingNotification(data.message.id);
                }
                break;

            case 'message_read':
                markBubbleAsRead(data.msg_id, data.read_at, data.burn_at, data.burn_mode);
                break;

            case 'message_countdown':
                markBubbleAsRead(data.msg_id, Date.now() / 1000, data.burn_at, data.burn_mode);
                break;

            case 'message_burned':
                triggerMessageBurnAnimation(data.msg_id);
                break;

            case 'message_recalled':
                handleMessageRecalled(data.msg_id, data.recalled_by);
                break;

            case 'peer_totp_reset':
                appendSystemNotice(data.message || `🔑 ${data.by_user} 重置了 ${data.target_user} 的 TOTP 验证器`);
                if (data.target_user === currentUser) {
                    alert(`🔑 您的 TOTP 验证器已被 ${data.by_user} 重置，请重新扫码绑定！`);
                    ironCrypto.clearKey();
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = '/?reset=' + Date.now();
                }
                break;

            case 'panic_wipe':
                alert(`🚨 ${data.message}`);
                ironCrypto.clearKey();
                localStorage.clear();
                sessionStorage.clear();
                window.location.href = '/?reset=' + Date.now();
                break;
        }
    }

    function updatePeerPresence(isOnline) {
        if (isOnline) {
            peerStatusDot.className = 'status-dot online';
            peerStatusText.textContent = '在线';
        } else {
            peerStatusDot.className = 'status-dot';
            peerStatusText.textContent = '离线';
        }
    }

    // Flush unread permanent messages when user returns to tab/app
    function flushPendingReads() {
        if (document.hidden) return;
        document.title = 'IronChat - 家庭加密即时通讯';
        for (const msgId of Array.from(pendingUnreadIds)) {
            pendingUnreadIds.delete(msgId);
            reportMessageRead(msgId);
        }
    }

    // Lifecycle Reconciliation Engine: Auto sync when app returns from background
    async function reconcileActiveMessages() {
        if (document.hidden) return;

        // 1. Re-establish WebSocket if closed/suspended in background
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }

        // 2. Fetch active messages from server (within 7-day retention)
        try {
            const res = await fetch('/api/messages');
            const data = await res.json();
            if (!data.success || !data.messages) return;

            const serverMsgs = data.messages;
            const serverIdSet = new Set(serverMsgs.map(m => m.id));

            // 3. Purge any message in DOM that was burned/recalled while in background
            const domRows = document.querySelectorAll('.message-row');
            for (const row of domRows) {
                const rowId = row.id.replace('msg-', '');
                if (!serverIdSet.has(rowId)) {
                    triggerMessageBurnAnimation(rowId);
                }
            }

            // 4. Update or append messages from server
            for (const sMsg of serverMsgs) {
                const stored = messageStore.get(sMsg.id);
                if (!stored) {
                    await renderMessageBubble(sMsg);
                } else {
                    if (sMsg.read_at && !stored.read_at) {
                        markBubbleAsRead(sMsg.id, sMsg.read_at, sMsg.burn_at, sMsg.burn_mode);
                    }
                    if (sMsg.burn_at && !stored.burn_at) {
                        updateMessageCountdown(sMsg.id, sMsg.burn_at, sMsg.burn_mode);
                    }
                    messageStore.set(sMsg.id, sMsg);
                }
            }

            // 5. Flush pending reads
            flushPendingReads();
        } catch (err) {
            console.warn('Reconciliation warning:', err);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            reconcileActiveMessages();
        }
    });
    window.addEventListener('focus', () => {
        reconcileActiveMessages();
    });

    // ==================== 5. Messages Rendering, Click-to-View Burn Envelope & Recall ====================
    async function loadHistoryMessages() {
        try {
            const res = await fetch('/api/messages');
            const data = await res.json();
            if (data.success && data.messages) {
                messagesContainer.innerHTML = '';
                messageStore.clear();
                for (const msg of data.messages) {
                    await renderMessageBubble(msg);
                }
                scrollToBottom();
            }
        } catch (e) {
            console.error('加载历史消息失败', e);
        }
    }

    function appendSystemNotice(text) {
        if (chatEmptyState) chatEmptyState.style.display = 'none';
        const pill = document.createElement('div');
        pill.className = 'system-notice-pill';
        pill.textContent = text;
        messagesContainer.appendChild(pill);
        scrollToBottom();
    }

    function getMsgTypeInfo(msg) {
        const map = {
            'text': { icon: 'fa-file-lines', label: '加密文字消息' },
            'image': { icon: 'fa-image', label: '加密图片' },
            'video': { icon: 'fa-film', label: '加密视频' },
            'audio': { icon: 'fa-waveform-lines', label: '加密音频/语音' },
            'file': { icon: 'fa-file-shield', label: `加密文件 (${formatBytes(msg.file_size)})` }
        };
        return map[msg.msg_type] || map['file'];
    }

    async function renderMessageBubble(msg) {
        if (chatEmptyState) chatEmptyState.style.display = 'none';
        messageStore.set(msg.id, msg);

        let bubbleEl = document.getElementById(`msg-${msg.id}`);
        if (bubbleEl) return;

        const isSent = msg.sender === currentUser;
        const isBurnable = Boolean(msg.burn_mode && msg.burn_mode !== 'never');

        const row = document.createElement('div');
        row.className = `message-row ${isSent ? 'sent' : 'received'}`;
        row.id = `msg-${msg.id}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        // Quote / Reply preview box if referencing another message
        if (msg.reply_to_id) {
            const quoteBox = document.createElement('div');
            quoteBox.className = 'message-quote-box';
            quoteBox.innerHTML = `
                <div class="quote-sender"><i class="fa-solid fa-reply fa-xs"></i> ${escapeHtml(msg.reply_to_sender || '原消息')}</div>
                <div class="quote-snippet">${escapeHtml(msg.reply_to_text || '[引用内容]')}</div>
            `;
            quoteBox.onclick = (e) => {
                e.stopPropagation();
                scrollToMessage(msg.reply_to_id);
            };
            bubble.appendChild(quoteBox);
        }

        if (isBurnable) {
            // 1. Burn Mode Header Badge
            const burnBadge = document.createElement('div');
            burnBadge.className = 'burn-indicator';
            burnBadge.id = `burn-badge-${msg.id}`;
            burnBadge.innerHTML = `<i class="fa-solid fa-fire"></i> <span>阅后即焚 · ${getBurnModeLabel(msg.burn_mode)}</span>`;
            bubble.appendChild(burnBadge);

            // 2. Confidential Click-to-View Envelope (NO direct inline preview!)
            const typeInfo = getMsgTypeInfo(msg);
            const envCard = document.createElement('div');
            envCard.className = 'burn-envelope-card';
            envCard.id = `burn-env-${msg.id}`;

            const subText = msg.burn_at
                ? '🔓 倒计时进行中 · 有效期内可再次点击查看'
                : (isSent
                    ? `🔒 点击可预览 · 对方拆阅后开启 ${getBurnModeLabel(msg.burn_mode)} 倒计时`
                    : `🔒 内容已隐藏 · 点击拆阅并开启 ${getBurnModeLabel(msg.burn_mode)} 倒计时`);

            envCard.innerHTML = `
                <div class="burn-envelope-icon"><i class="fa-solid ${typeInfo.icon}"></i></div>
                <div class="burn-envelope-info">
                    <div class="burn-envelope-title">🔥 ${typeInfo.label}</div>
                    <div class="burn-envelope-sub" id="burn-sub-${msg.id}">${subText}</div>
                </div>
            `;
            envCard.onclick = () => {
                const latestMsg = messageStore.get(msg.id) || msg;
                openBurnViewerModal(latestMsg);
            };
            bubble.appendChild(envCard);
        } else {
            // Permanent message (burn_mode === 'never'): inline preview
            await renderInlineContent(bubble, msg);
        }

        // Meta footer: Time + Read Receipt + Recall Button
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        const d = new Date(msg.created_at * 1000);
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        const timeSpan = document.createElement('span');
        timeSpan.textContent = timeStr;
        meta.appendChild(timeSpan);

        if (isSent) {
            const readBadge = document.createElement('span');
            readBadge.id = `read-badge-${msg.id}`;
            if (msg.read_at) {
                readBadge.className = 'read-badge read';
                readBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> 已读`;
            } else {
                readBadge.className = 'read-badge unread';
                readBadge.innerHTML = `<i class="fa-solid fa-check"></i> 未读`;
            }
            meta.appendChild(readBadge);
        }

        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'btn-reply';
        replyBtn.innerHTML = `<i class="fa-solid fa-reply"></i> 回复`;
        replyBtn.title = '引用并回复该消息';
        replyBtn.onclick = (e) => {
            e.stopPropagation();
            setReplyingTo(msg);
        };
        meta.appendChild(replyBtn);

        const recallBtn = document.createElement('button');
        recallBtn.type = 'button';
        recallBtn.className = 'btn-recall';
        recallBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> 撤回`;
        recallBtn.title = '在双方设备上同时撤回并物理擦除此消息';
        recallBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
                await fetch(`/api/messages/${msg.id}/recall`, { method: 'POST' });
            } catch (err) {
                alert(`撤回失败: ${err.message}`);
            }
        };
        meta.appendChild(recallBtn);

        bubble.appendChild(meta);
        row.appendChild(bubble);
        messagesContainer.appendChild(row);

        // Only permanent ('never') messages auto-mark read on render;
        // Burnable messages strictly wait for the recipient to CLICK the envelope!
        if (!isSent && !isBurnable && !msg.read_at) {
            if (!document.hidden) {
                reportMessageRead(msg.id);
            } else {
                pendingUnreadIds.add(msg.id);
            }
        }

        if (msg.burn_at) {
            updateMessageCountdown(msg.id, msg.burn_at, msg.burn_mode);
        }
    }

    // ==================== File & Media Helpers ====================
    function sniffFileNameByMagicBytes(buffer, defaultName = 'file.dat') {
        if (!buffer || buffer.byteLength < 4) return defaultName;
        const bytes = new Uint8Array(buffer.slice(0, 16));
        // ZIP: PK\x03\x04, PK\x05\x06, PK\x07\x08
        if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
            return 'archive.zip';
        }
        // PDF: %PDF
        if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
            return 'document.pdf';
        }
        // PNG: \x89PNG
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
            return 'image.png';
        }
        // JPEG: \xFF\xD8\xFF
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
            return 'image.jpg';
        }
        // GIF: GIF8
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
            return 'image.gif';
        }
        // WebP: RIFF....WEBP
        if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
            return 'image.webp';
        }
        // MP4: ....ftyp
        if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
            return 'video.mp4';
        }
        return defaultName;
    }

    function getMimeTypeFromFileName(fileName, fallbackType = 'application/octet-stream') {
        if (!fileName) return fallbackType;
        const ext = fileName.split('.').pop().toLowerCase();
        const map = {
            'zip': 'application/zip',
            'rar': 'application/x-rar-compressed',
            '7z': 'application/x-7z-compressed',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime',
            'webm': 'video/webm',
            'mkv': 'video/x-matroska',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'm4a': 'audio/mp4',
            'ogg': 'audio/ogg',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'txt': 'text/plain',
            'json': 'application/json'
        };
        return map[ext] || fallbackType;
    }

    async function resolveFileName(msg, decryptedBuffer = null) {
        let name = null;
        if (msg.file_name) {
            try {
                if (typeof msg.file_name === 'string' && msg.file_name.trim().startsWith('{')) {
                    const parsed = JSON.parse(msg.file_name);
                    const cipher = parsed.name || parsed.ciphertext;
                    const iv = parsed.iv;
                    if (cipher && iv) {
                        name = await ironCrypto.decryptText(cipher, iv);
                    }
                } else {
                    name = await ironCrypto.decryptText(msg.file_name, msg.iv);
                }
            } catch {
                name = null;
            }
        }

        if (!name || name === 'attachment' || name === 'file.dat') {
            if (decryptedBuffer) {
                const guessed = sniffFileNameByMagicBytes(decryptedBuffer, null);
                if (guessed) return guessed;
            }
            const defaultNames = { 'image': 'image.jpg', 'video': 'video.mp4', 'audio': 'audio.mp3', 'file': 'archive.zip' };
            return defaultNames[msg.msg_type] || 'file.dat';
        }
        return name;
    }

    async function triggerFileDownload(blob, fileName) {
        if (!blob) return;
        const mime = getMimeTypeFromFileName(fileName, blob.type || 'application/octet-stream');
        const typedBlob = (blob.type === mime) ? blob : new Blob([blob], { type: mime });

        // 1. Mobile Web Share API support (iOS Safari / iPad / Android)
        // Enables direct "Save Video" to Camera Roll, "Save Image" to Photos, or Save to Files
        if (navigator.canShare) {
            try {
                const file = new File([typedBlob], fileName, { type: mime });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: fileName
                    });
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') return; // User cancelled share sheet
                console.warn('navigator.share failed, fallback to standard download', err);
            }
        }

        // 2. Desktop Browser standard <a> download fallback
        const url = URL.createObjectURL(typedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 1500);
    }

    async function extractCaption(msg) {
        if (!msg.ciphertext || msg.ciphertext === 'FILE_PAYLOAD') return null;
        try {
            if (msg.ciphertext.startsWith('{"caption":')) {
                const parsed = JSON.parse(msg.ciphertext);
                return await ironCrypto.decryptText(parsed.caption, parsed.caption_iv);
            } else {
                return await ironCrypto.decryptText(msg.ciphertext, msg.iv);
            }
        } catch {
            return null;
        }
    }

    async function renderInlineContent(container, msg) {
        try {
            if (msg.msg_type === 'text') {
                const plainText = await ironCrypto.decryptText(msg.ciphertext, msg.iv);
                messagePlainCache.set(msg.id, plainText);
                const textSpan = document.createElement('div');
                textSpan.style.whiteSpace = 'pre-wrap';
                textSpan.textContent = plainText;
                container.appendChild(textSpan);
            } else if (msg.msg_type === 'image') {
                const imgWrap = document.createElement('div');
                imgWrap.className = 'bubble-image-wrap';
                imgWrap.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> 正在解密图片...</div>`;
                container.appendChild(imgWrap);

                fetchAndDecryptFile(msg.file_id, msg.iv).then(async decryptedBuffer => {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'image/jpeg');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    imgWrap.innerHTML = `<img src="${blobUrl}" class="bubble-image" alt="加密图片">`;
                    imgWrap.onclick = () => {
                        lightboxImg.src = blobUrl;
                        activeLightboxBlob = blob;
                        activeLightboxFileName = plainFileName;
                        lightboxModal.style.display = 'flex';
                    };
                }).catch(() => {
                    imgWrap.innerHTML = `<div style="padding: 10px; color: #f87171;">⚠️ 图片已失效或解密失败</div>`;
                });
            } else if (msg.msg_type === 'video') {
                const videoWrap = document.createElement('div');
                videoWrap.className = 'bubble-video-wrap';
                videoWrap.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> 正在解密视频...</div>`;
                container.appendChild(videoWrap);

                fetchAndDecryptFile(msg.file_id, msg.iv).then(async decryptedBuffer => {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'video/mp4');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);

                    videoWrap.innerHTML = `
                        <video src="${blobUrl}" controls preload="metadata" playsinline style="max-width: 100%; border-radius: 10px; display: block;"></video>
                        <div class="media-download-bar">
                            <div class="media-download-info">
                                <i class="fa-solid fa-film"></i>
                                <span class="media-download-name">${escapeHtml(plainFileName)}</span>
                                <span class="media-download-size">(${formatBytes(msg.file_size)})</span>
                            </div>
                            <button class="btn-media-download" title="下载/保存视频到本地">
                                <i class="fa-solid fa-arrow-down-to-line"></i> 下载视频
                            </button>
                        </div>
                    `;
                    const btnDl = videoWrap.querySelector('.btn-media-download');
                    if (btnDl) {
                        btnDl.onclick = async (e) => {
                            e.stopPropagation();
                            btnDl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 处理中...`;
                            try {
                                await triggerFileDownload(blob, plainFileName);
                            } finally {
                                btnDl.innerHTML = `<i class="fa-solid fa-arrow-down-to-line"></i> 下载视频`;
                            }
                        };
                    }
                }).catch(() => {
                    videoWrap.innerHTML = `<div style="padding: 10px; color: #f87171;">⚠️ 视频已失效或解密失败</div>`;
                });
            } else if (msg.msg_type === 'audio') {
                const audioWrap = document.createElement('div');
                audioWrap.innerHTML = `<div style="padding: 12px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> 正在解密音频...</div>`;
                container.appendChild(audioWrap);

                fetchAndDecryptFile(msg.file_id, msg.iv).then(async decryptedBuffer => {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'audio/mpeg');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    audioWrap.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <audio src="${blobUrl}" controls style="max-width: 220px;"></audio>
                            <button class="btn-media-download" style="padding: 6px 10px;" title="下载音频">
                                <i class="fa-solid fa-arrow-down-to-line"></i>
                            </button>
                        </div>
                    `;
                    const btnDl = audioWrap.querySelector('.btn-media-download');
                    if (btnDl) {
                        btnDl.onclick = () => triggerFileDownload(blob, plainFileName);
                    }
                }).catch(() => {
                    audioWrap.innerHTML = `<div style="padding: 10px; color: #f87171;">⚠️ 音频已失效或解密失败</div>`;
                });
            } else {
                let initialName = '正在获取文件名...';
                try {
                    initialName = await resolveFileName(msg);
                } catch {
                    initialName = '加密文件';
                }

                const fileCard = document.createElement('div');
                fileCard.className = 'bubble-file-card';
                fileCard.innerHTML = `
                    <div class="bubble-file-icon"><i class="fa-solid fa-file-shield"></i></div>
                    <div class="bubble-file-info">
                        <div class="bubble-file-name">${escapeHtml(initialName)}</div>
                        <div class="bubble-file-size">${formatBytes(msg.file_size)} · 点击安全解密下载</div>
                    </div>
                `;
                fileCard.onclick = async () => {
                    fileCard.style.opacity = '0.6';
                    try {
                        const decryptedBuffer = await fetchAndDecryptFile(msg.file_id, msg.iv);
                        const finalFileName = await resolveFileName(msg, decryptedBuffer);
                        const mime = getMimeTypeFromFileName(finalFileName);
                        const blob = new Blob([decryptedBuffer], { type: mime });
                        fileCard.querySelector('.bubble-file-name').textContent = finalFileName;
                        await triggerFileDownload(blob, finalFileName);
                        fileCard.style.opacity = '1';
                    } catch (e) {
                        alert(`文件下载解密失败: ${e.message}`);
                        fileCard.style.opacity = '1';
                    }
                };
                container.appendChild(fileCard);
            }

            // If non-text message has accompanying caption text, render it below the media
            if (msg.msg_type !== 'text') {
                const captionText = await extractCaption(msg);
                if (captionText) {
                    messagePlainCache.set(msg.id, captionText);
                    const captionEl = document.createElement('div');
                    captionEl.className = 'bubble-caption';
                    captionEl.textContent = captionText;
                    container.appendChild(captionEl);
                }
            }
        } catch {
            const errDiv = document.createElement('div');
            errDiv.style.color = '#f87171';
            errDiv.textContent = '🔒 [端对端解密失败：密文损坏]';
            container.appendChild(errDiv);
        }
    }

    // Active blob URLs created during burn preview to revoke on close
    let activeBurnBlobUrls = [];

    // ==================== 5B. Click-to-View Burn Viewer Modal (Repeatable within Countdown) ====================
    async function openBurnViewerModal(msg) {
        currentViewingBurnMsgId = msg.id;
        burnViewerModal.style.display = 'flex';

        // Timer updater
        if (burnViewerInterval) clearInterval(burnViewerInterval);
        function updateModalTimer() {
            const latest = messageStore.get(msg.id) || msg;
            if (latest.burn_at) {
                const rem = Math.max(0, Math.ceil(latest.burn_at - Date.now() / 1000));
                burnViewerTimerBadge.innerHTML = `<i class="fa-solid fa-fire fa-fade"></i> 剩余 ${rem} 秒焚毁`;
                if (rem <= 0) {
                    closeBurnViewerModal();
                    triggerMessageBurnAnimation(msg.id);
                }
            } else if (msg.sender === currentUser) {
                burnViewerTimerBadge.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> 待对方拆阅解密后计时 (${getBurnModeLabel(latest.burn_mode)})`;
            } else {
                burnViewerTimerBadge.innerHTML = `<i class="fa-solid fa-hourglass-start"></i> 解密中（倒计时将在解密呈现后开始）`;
            }
        }
        updateModalTimer();

        // Helper: Trigger read on server & start countdown timer strictly after client decryption is finished
        async function completeDecryptionAndStartBurn() {
            if (currentViewingBurnMsgId !== msg.id) return; // User closed modal already

            // If recipient is opening for the first time, trigger read & start server burn timer now!
            if (msg.sender !== currentUser && !msg.read_at) {
                try {
                    const res = await fetch(`/api/messages/${msg.id}/read`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success && data.message) {
                        msg = data.message;
                        messageStore.set(msg.id, msg);
                        markBubbleAsRead(msg.id, msg.read_at, msg.burn_at, msg.burn_mode);
                    }
                } catch (e) {
                    console.error('Trigger burn read error:', e);
                }
            }

            updateModalTimer();
            if (burnViewerInterval) clearInterval(burnViewerInterval);
            burnViewerInterval = setInterval(updateModalTimer, 500);
        }

        if (msg.msg_type === 'text') {
            burnViewerBody.innerHTML = `<div style="padding: 24px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> 正在解密文本...</div>`;
            try {
                const plainText = await ironCrypto.decryptText(msg.ciphertext, msg.iv);
                if (currentViewingBurnMsgId !== msg.id) return;

                const textSpan = document.createElement('div');
                textSpan.style.whiteSpace = 'pre-wrap';
                textSpan.style.wordBreak = 'break-word';
                textSpan.style.fontSize = '16px';
                textSpan.style.lineHeight = '1.6';
                textSpan.textContent = plainText;
                burnViewerBody.innerHTML = '';
                burnViewerBody.appendChild(textSpan);

                await completeDecryptionAndStartBurn();
            } catch {
                burnViewerBody.innerHTML = `<div style="color: #f87171; padding: 20px;">🔒 [端对端解密失败：密文损坏]</div>`;
            }
        } else {
            // Non-text message: Decryption takes time! Countdown starts ONLY AFTER decryption is completely finished!
            const typeLabels = { 'image': '图片', 'video': '视频', 'audio': '音频', 'file': '附件文件' };
            const typeLabel = typeLabels[msg.msg_type] || '附件';

            burnViewerTimerBadge.innerHTML = `<i class="fa-solid fa-hourglass-start"></i> 解密中（倒计时将在解密呈现后开始）`;
            burnViewerBody.innerHTML = `
                <div style="padding: 36px 16px; text-align: center; color: var(--text-muted);">
                    <div style="font-size: 36px; margin-bottom: 12px; color: var(--accent);"><i class="fa-solid fa-lock-open fa-fade"></i></div>
                    <div style="font-size: 15px; font-weight: 500; margin-bottom: 6px;">正在安全下载并解密${typeLabel}...</div>
                    <div style="font-size: 12px; opacity: 0.75;">⏳ 为保障完整浏览时间，焚毁倒计时将在内容解密完毕后正式开始</div>
                </div>
            `;

            try {
                const decryptedBuffer = await fetchAndDecryptFile(msg.file_id, msg.iv);
                if (currentViewingBurnMsgId !== msg.id) return;

                burnViewerBody.innerHTML = '';
                if (msg.msg_type === 'image') {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'image/jpeg');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    activeBurnBlobUrls.push(blobUrl);

                    const img = document.createElement('img');
                    img.src = blobUrl;
                    img.className = 'bubble-image';
                    img.style.maxHeight = '65vh';
                    img.style.maxWidth = '100%';
                    img.style.borderRadius = '12px';
                    img.style.display = 'block';
                    img.style.margin = '0 auto';
                    img.style.cursor = 'zoom-in';
                    img.onclick = () => {
                        lightboxImg.src = blobUrl;
                        activeLightboxBlob = blob;
                        activeLightboxFileName = plainFileName;
                        lightboxModal.style.display = 'flex';
                    };
                    burnViewerBody.appendChild(img);

                    const dlWrap = document.createElement('div');
                    dlWrap.style.margin = '14px 0 6px 0';
                    dlWrap.style.textAlign = 'center';
                    dlWrap.innerHTML = `
                        <button class="btn-media-download" style="padding: 8px 18px; font-size: 13px; border-radius: 20px;">
                            <i class="fa-solid fa-arrow-down-to-line"></i> 保存图片到本地 (${formatBytes(msg.file_size)})
                        </button>
                    `;
                    const btnDl = dlWrap.querySelector('.btn-media-download');
                    btnDl.onclick = async () => {
                        btnDl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 处理中...`;
                        try {
                            await triggerFileDownload(blob, plainFileName);
                        } finally {
                            btnDl.innerHTML = `<i class="fa-solid fa-arrow-down-to-line"></i> 保存图片到本地 (${formatBytes(msg.file_size)})`;
                        }
                    };
                    burnViewerBody.appendChild(dlWrap);
                } else if (msg.msg_type === 'video') {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'video/mp4');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    activeBurnBlobUrls.push(blobUrl);

                    const video = document.createElement('video');
                    video.src = blobUrl;
                    video.controls = true;
                    video.autoplay = true;
                    video.playsInline = true;
                    video.style.maxHeight = '65vh';
                    video.style.maxWidth = '100%';
                    video.style.borderRadius = '12px';
                    video.style.display = 'block';
                    video.style.margin = '0 auto';
                    burnViewerBody.appendChild(video);

                    const dlWrap = document.createElement('div');
                    dlWrap.style.margin = '14px 0 6px 0';
                    dlWrap.style.textAlign = 'center';
                    dlWrap.innerHTML = `
                        <button class="btn-media-download" style="padding: 8px 18px; font-size: 13px; border-radius: 20px;">
                            <i class="fa-solid fa-arrow-down-to-line"></i> 保存/下载视频 (${formatBytes(msg.file_size)})
                        </button>
                    `;
                    const btnDl = dlWrap.querySelector('.btn-media-download');
                    btnDl.onclick = async () => {
                        btnDl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 处理中...`;
                        try {
                            await triggerFileDownload(blob, plainFileName);
                        } finally {
                            btnDl.innerHTML = `<i class="fa-solid fa-arrow-down-to-line"></i> 保存/下载视频 (${formatBytes(msg.file_size)})`;
                        }
                    };
                    burnViewerBody.appendChild(dlWrap);
                } else if (msg.msg_type === 'audio') {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName, 'audio/mpeg');
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    activeBurnBlobUrls.push(blobUrl);

                    const wrap = document.createElement('div');
                    wrap.style.padding = '24px';
                    wrap.style.textAlign = 'center';
                    const audio = document.createElement('audio');
                    audio.src = blobUrl;
                    audio.controls = true;
                    audio.autoplay = true;
                    audio.style.width = '100%';
                    audio.style.maxWidth = '360px';
                    wrap.appendChild(audio);

                    const dlWrap = document.createElement('div');
                    dlWrap.style.marginTop = '12px';
                    dlWrap.innerHTML = `
                        <button class="btn-media-download" style="padding: 6px 14px; font-size: 12px; border-radius: 16px;">
                            <i class="fa-solid fa-arrow-down-to-line"></i> 保存音频到本地
                        </button>
                    `;
                    dlWrap.querySelector('.btn-media-download').onclick = () => triggerFileDownload(blob, plainFileName);
                    wrap.appendChild(dlWrap);
                    burnViewerBody.appendChild(wrap);
                } else {
                    const plainFileName = await resolveFileName(msg, decryptedBuffer);
                    const mime = getMimeTypeFromFileName(plainFileName);
                    const blob = new Blob([decryptedBuffer], { type: mime });
                    const blobUrl = URL.createObjectURL(blob);
                    activeBurnBlobUrls.push(blobUrl);

                    const card = document.createElement('div');
                    card.className = 'bubble-file-card';
                    card.style.padding = '18px';
                    card.style.background = 'rgba(255, 255, 255, 0.06)';
                    card.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                    card.style.borderRadius = '12px';
                    card.style.cursor = 'pointer';
                    card.innerHTML = `
                        <div class="bubble-file-icon" style="font-size: 30px; color: var(--accent);"><i class="fa-solid fa-file-shield"></i></div>
                        <div class="bubble-file-info" style="margin-left: 14px;">
                            <div class="bubble-file-name" style="font-weight: 600; font-size: 15px;">${escapeHtml(plainFileName)}</div>
                            <div class="bubble-file-size" style="font-size: 12px; color: var(--accent-green); margin-top: 4px;">✅ 已完成内存解密 (${formatBytes(msg.file_size)}) · 点击立即保存到本地</div>
                        </div>
                    `;
                    card.onclick = async () => {
                        card.style.opacity = '0.7';
                        try {
                            await triggerFileDownload(blob, plainFileName);
                        } finally {
                            card.style.opacity = '1';
                        }
                    };
                    burnViewerBody.appendChild(card);
                }

                // If non-text message has accompanying caption text, render it below the media in viewer
                const captionText = await extractCaption(msg);
                if (captionText) {
                    messagePlainCache.set(msg.id, captionText);
                    const capBox = document.createElement('div');
                    capBox.style.cssText = 'margin-top: 14px; padding: 12px 16px; background: rgba(0, 0, 0, 0.35); border-radius: 10px; font-size: 14.5px; line-height: 1.5; text-align: left; word-break: break-word; color: #f1f5f9; border: 1px solid rgba(255, 255, 255, 0.08);';
                    capBox.textContent = captionText;
                    burnViewerBody.appendChild(capBox);
                }

                // Decryption and element mounting is 100% complete! Now start countdown!
                await completeDecryptionAndStartBurn();

            } catch (err) {
                if (currentViewingBurnMsgId !== msg.id) return;
                burnViewerBody.innerHTML = `<div style="padding: 24px; color: #f87171; text-align: center;"><i class="fa-solid fa-triangle-exclamation"></i> 附件已销毁或解密失败: ${escapeHtml(err.message || '未知错误')}</div>`;
                burnViewerTimerBadge.innerHTML = `<i class="fa-solid fa-ban"></i> 无法解密`;
            }
        }
    }

    function closeBurnViewerModal() {
        currentViewingBurnMsgId = null;
        if (burnViewerInterval) {
            clearInterval(burnViewerInterval);
            burnViewerInterval = null;
        }
        activeBurnBlobUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch {}
        });
        activeBurnBlobUrls = [];
        burnViewerBody.innerHTML = '';
        burnViewerModal.style.display = 'none';
    }

    btnCloseBurnViewer.addEventListener('click', closeBurnViewerModal);

    function markBubbleAsRead(msgId, readAt, burnAt, burnMode) {
        const stored = messageStore.get(msgId);
        if (stored) {
            if (readAt) stored.read_at = readAt;
            if (burnAt) stored.burn_at = burnAt;
        }

        const readBadge = document.getElementById(`read-badge-${msgId}`);
        if (readBadge) {
            readBadge.className = 'read-badge read';
            readBadge.innerHTML = `<i class="fa-solid fa-check-double"></i> 已读`;
        }

        const subEl = document.getElementById(`burn-sub-${msgId}`);
        if (subEl && burnAt) {
            subEl.textContent = '🔓 倒计时进行中 · 有效期内可再次点击查看';
        }

        if (burnAt) {
            updateMessageCountdown(msgId, burnAt, burnMode);
        }
    }

    function handleMessageRecalled(msgId, recalledBy) {
        if (currentViewingBurnMsgId === msgId) {
            closeBurnViewerModal();
        }
        messageStore.delete(msgId);
        const row = document.getElementById(`msg-${msgId}`);
        const who = (recalledBy === currentUser) ? '你' : recalledBy;
        if (row) {
            const pill = document.createElement('div');
            pill.className = 'system-notice-pill';
            pill.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${escapeHtml(who)} 撤回了一条消息`;
            row.replaceWith(pill);
        }
    }

    async function fetchAndDecryptFile(fileId, iv) {
        const res = await fetch(`/api/files/${fileId}`);
        if (!res.ok) throw new Error('文件不存在或已被销毁');
        const encryptedBuffer = await res.arrayBuffer();
        return await ironCrypto.decryptBinary(encryptedBuffer, iv);
    }

    function reportMessageRead(msgId) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'read', msg_id: msgId }));
        } else {
            fetch(`/api/messages/${msgId}/read`, { method: 'POST' }).catch(() => {});
        }
    }

    function updateMessageCountdown(msgId, burnAt, burnMode) {
        const badge = document.getElementById(`burn-badge-${msgId}`);
        if (!badge || badge.dataset.counting === '1') return;
        badge.dataset.counting = '1';
        badge.classList.add('active');

        function updateTick() {
            const now = Date.now() / 1000;
            const remaining = Math.max(0, Math.ceil(burnAt - now));
            if (remaining > 0) {
                badge.innerHTML = `<i class="fa-solid fa-fire fa-fade"></i> <span>自毁倒计时: ${remaining}s (点击可重看)</span>`;
            } else {
                badge.innerHTML = `<i class="fa-solid fa-skull"></i> <span>已焚毁</span>`;
                clearInterval(t);
                triggerMessageBurnAnimation(msgId);
            }
        }
        updateTick();
        const t = setInterval(updateTick, 1000);
    }

    function triggerMessageBurnAnimation(msgId) {
        if (currentViewingBurnMsgId === msgId) {
            closeBurnViewerModal();
        }
        messageStore.delete(msgId);
        const row = document.getElementById(`msg-${msgId}`);
        if (row && !row.classList.contains('burning')) {
            row.classList.add('burning');
            setTimeout(() => {
                row.remove();
            }, 600);
        }
    }

    // ==================== 6. Quote / Reply & Gemini-style Staging Tray ====================
    function setReplyingTo(msg) {
        let snippet = getReplySnippet(msg);
        activeReplyMsg = {
            id: msg.id,
            sender: msg.sender,
            snippet: snippet
        };
        if (replyBarSender) {
            replyBarSender.innerHTML = `<i class="fa-solid fa-reply fa-xs"></i> 回复 ${escapeHtml(activeReplyMsg.sender === currentUser ? '自己' : activeReplyMsg.sender)}`;
        }
        if (replyBarSnippet) {
            replyBarSnippet.textContent = snippet;
        }
        if (replyBar) {
            replyBar.style.display = 'flex';
        }
        chatInput.focus();
    }

    function cancelReplying() {
        activeReplyMsg = null;
        if (replyBar) {
            replyBar.style.display = 'none';
        }
        if (replyBarSender) replyBarSender.textContent = '';
        if (replyBarSnippet) replyBarSnippet.textContent = '';
    }

    if (btnCancelReply) {
        btnCancelReply.addEventListener('click', cancelReplying);
    }

    function getReplySnippet(msg) {
        const cached = messagePlainCache.get(msg.id);
        if (cached) {
            const clean = cached.replace(/\s+/g, ' ').trim();
            const prefix = msg.msg_type === 'text' ? '' : `[${getMsgTypeShortName(msg.msg_type)}] `;
            return prefix + (clean.length > 50 ? clean.slice(0, 50) + '...' : clean);
        }
        return `[${getMsgTypeShortName(msg.msg_type)}]`;
    }

    function getMsgTypeShortName(type) {
        const map = { 'text': '文字', 'image': '图片', 'video': '视频', 'audio': '语音', 'file': '文件' };
        return map[type] || '附件';
    }

    function scrollToMessage(msgId) {
        const row = document.getElementById(`msg-${msgId}`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.remove('quote-highlighted');
            void row.offsetWidth; // trigger reflow
            row.classList.add('quote-highlighted');
            setTimeout(() => row.classList.remove('quote-highlighted'), 1500);
        } else {
            alert('该被引用消息已焚毁或不存在');
        }
    }

    function addStagedFiles(files) {
        if (!files || files.length === 0) return;
        for (const f of files) {
            const id = 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            let previewUrl = null;
            if (f.type.startsWith('image/')) {
                previewUrl = URL.createObjectURL(f);
            }
            stagedAttachments.push({ file: f, id, previewUrl });
        }
        renderStagedTray();
        chatInput.focus();
    }

    function removeStagedFile(id) {
        const item = stagedAttachments.find(x => x.id === id);
        if (item && item.previewUrl) {
            try { URL.revokeObjectURL(item.previewUrl); } catch {}
        }
        stagedAttachments = stagedAttachments.filter(x => x.id !== id);
        renderStagedTray();
    }

    function renderStagedTray() {
        if (!attachmentTray) return;
        if (stagedAttachments.length === 0) {
            attachmentTray.innerHTML = '';
            attachmentTray.style.display = 'none';
            return;
        }

        attachmentTray.innerHTML = '';
        attachmentTray.style.display = 'flex';

        for (const item of stagedAttachments) {
            const f = item.file;
            const chip = document.createElement('div');
            chip.className = 'staged-chip';

            let iconHtml = '';
            if (item.previewUrl) {
                iconHtml = `<img src="${item.previewUrl}" class="staged-thumb" alt="预览">`;
            } else {
                const iconClass = f.type.startsWith('video/') ? 'fa-film' : (f.type.startsWith('audio/') ? 'fa-waveform-lines' : 'fa-file-shield');
                iconHtml = `<div class="staged-file-icon"><i class="fa-solid ${iconClass}"></i></div>`;
            }

            chip.innerHTML = `
                ${iconHtml}
                <div class="staged-info">
                    <div class="staged-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                    <div class="staged-size">${formatBytes(f.size)}</div>
                </div>
                <button type="button" class="btn-remove-chip" title="移除"><i class="fa-solid fa-xmark"></i></button>
            `;

            chip.querySelector('.btn-remove-chip').onclick = (e) => {
                e.stopPropagation();
                removeStagedFile(item.id);
            };

            attachmentTray.appendChild(chip);
        }
    }

    // ==================== 6B. Unified Sending (Compound Media + Caption & Quote) ====================
    async function sendUnifiedMessage() {
        const text = chatInput.value.trim();
        const hasAttachments = stagedAttachments.length > 0;
        if (!text && !hasAttachments) return;

        if (!ironCrypto.hasKey()) {
            await checkAuth();
            if (!ironCrypto.hasKey()) {
                alert('端对端加密初始化中，请稍后重试');
                return;
            }
        }

        const burnMode = burnModeSelect.value;
        const currentReply = activeReplyMsg ? { ...activeReplyMsg } : null;

        // Reset input immediately for responsive UI
        chatInput.value = '';
        chatInput.style.height = 'auto';
        cancelReplying();

        const currentAttachments = [...stagedAttachments];
        stagedAttachments = [];
        renderStagedTray();

        try {
            if (currentAttachments.length > 0) {
                // Compound Message: Upload file(s) with accompanying text caption
                const encText = text ? await ironCrypto.encryptText(text) : null;
                const captionPayload = encText
                    ? JSON.stringify({ caption: encText.ciphertext, caption_iv: encText.iv })
                    : 'FILE_PAYLOAD';

                for (let i = 0; i < currentAttachments.length; i++) {
                    const item = currentAttachments[i];
                    const file = item.file;
                    if (item.previewUrl) {
                        try { URL.revokeObjectURL(item.previewUrl); } catch {}
                    }

                    let msgType = 'file';
                    if (file.type.startsWith('image/')) msgType = 'image';
                    else if (file.type.startsWith('video/')) msgType = 'video';
                    else if (file.type.startsWith('audio/')) msgType = 'audio';

                    const arrayBuffer = await file.arrayBuffer();
                    const encBinary = await ironCrypto.encryptBinary(arrayBuffer);
                    const encFileName = await ironCrypto.encryptText(file.name);
                    const serializedFileName = JSON.stringify({ name: encFileName.ciphertext, iv: encFileName.iv });

                    const formData = new FormData();
                    formData.append('file', encBinary.encryptedBlob, 'encrypted.bin');

                    const uploadRes = await fetch('/api/files/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadRes.ok || !uploadData.success) {
                        throw new Error('上传附件失败');
                    }

                    // Attach caption to first file in bundle to avoid duplicate caption display
                    const payloadCiphertext = (i === 0) ? captionPayload : 'FILE_PAYLOAD';

                    await fetch('/api/messages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ciphertext: payloadCiphertext,
                            iv: encBinary.iv,
                            msg_type: msgType,
                            file_id: uploadData.file_id,
                            file_name: serializedFileName,
                            file_size: file.size,
                            burn_mode: burnMode,
                            reply_to_id: currentReply ? currentReply.id : null,
                            reply_to_sender: currentReply ? currentReply.sender : null,
                            reply_to_text: currentReply ? currentReply.snippet : null
                        })
                    });
                }
            } else {
                // Pure Text message
                const enc = await ironCrypto.encryptText(text);
                await fetch('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ciphertext: enc.ciphertext,
                        iv: enc.iv,
                        msg_type: 'text',
                        burn_mode: burnMode,
                        reply_to_id: currentReply ? currentReply.id : null,
                        reply_to_sender: currentReply ? currentReply.sender : null,
                        reply_to_text: currentReply ? currentReply.snippet : null
                    })
                });
            }
        } catch (e) {
            alert(`发送失败: ${e.message}`);
        }
    }

    btnSend.addEventListener('click', sendUnifiedMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendUnifiedMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = `${Math.min(120, chatInput.scrollHeight)}px`;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'typing', is_typing: true }));
        }
    });

    // Clipboard Paste Listener on chatInput & window (Images & Files)
    chatInput.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const files = [];
        if (clipboardData.items) {
            for (let i = 0; i < clipboardData.items.length; i++) {
                const item = clipboardData.items[i];
                if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                }
            }
        } else if (clipboardData.files && clipboardData.files.length > 0) {
            for (let i = 0; i < clipboardData.files.length; i++) {
                files.push(clipboardData.files[i]);
            }
        }

        if (files.length > 0) {
            e.preventDefault();
            addStagedFiles(files);
        }
    });

    // Window Drag and Drop
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addStagedFiles(Array.from(e.dataTransfer.files));
        }
    });

    // Attach Button File Selector
    btnAttach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            addStagedFiles(Array.from(fileInput.files));
            fileInput.value = '';
        }
    });

    // ==================== 7. Panic Button: 删库跑路gogogo ====================
    btnPanic.addEventListener('click', () => {
        panicModal.style.display = 'flex';
        inputPanicConfirm.value = '';
        setTimeout(() => inputPanicConfirm.focus(), 100);
    });

    btnCancelPanic.addEventListener('click', () => {
        panicModal.style.display = 'none';
    });

    btnExecutePanic.addEventListener('click', async () => {
        const confirmVal = inputPanicConfirm.value.trim();
        if (confirmVal !== '删库跑路') {
            alert('输入确认词不匹配，已阻断自毁');
            return;
        }

        btnExecutePanic.disabled = true;
        btnExecutePanic.textContent = '🚨 正在执行物理覆写粉碎...';

        try {
            const res = await fetch('/api/panic', { method: 'POST' });
            const data = await res.json();
            alert(`✅ ${data.message}`);
            ironCrypto.clearKey();
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = '/?reset=' + Date.now();
        } catch (e) {
            alert(`自毁执行完毕: ${e.message}`);
            window.location.href = '/?reset=' + Date.now();
        }
    });

    // Helper functions
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function getBurnModeLabel(mode) {
        const map = {
            'immediate': '即阅即焚 (5s)',
            '10s': '10秒自毁',
            '30s': '30秒自毁',
            '1m': '1分钟自毁',
            '5m': '5分钟自毁',
            '1h': '1小时自毁',
            '24h': '24小时自毁',
            'never': '永久保存'
        };
        return map[mode] || mode;
    }

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    // Launch
    checkAuth();
});
