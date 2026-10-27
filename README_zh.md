<div align="center">

# 🔒 IronChat

### 专为双人打造的极致私密端对端加密即时通讯系统

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](deployments/docker-compose.yml)
[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](requirements.txt)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-green.svg)](docs/zh/ARCHITECTURE.md)
[![Web Push: RFC 8030](https://img.shields.io/badge/Web_Push-RFC_8030_VAPID-orange.svg)](docs/zh/WEBPUSH_GUIDE.md)

[English Documentation](README.md) • [中文说明书](README_zh.md) • [详细部署指南](docs/zh/DEPLOYMENT.md) • [安全技术白皮书](docs/zh/ARCHITECTURE.md)

</div>

---

## 💡 项目简介

**IronChat** 是一个专为**伴侣、至亲或极高隐私需求伙伴**设计的开源零知识（Zero-Knowledge）端对端加密双人即时通讯软件。

不同于数据长期留存在云端中心化服务器的主流社交软件，IronChat 从底层贯彻了以下原则：
- **严格限定双用户白名单**，拒绝任何第三方注册与无关信息骚扰；
- 浏览器硬件级 **WebCrypto AES-256-GCM 本地加解密**，服务端充当纯零知识中继，无法窥探明文消息与附件；
- **客户端零磁盘持久缓存（RAM-Only）**，关闭标签页即刻蒸发，抵御底层磁盘反取证扫描；
- **多档阅后即焚** 与 **两遍随机字节物理粉碎（Data Shredder）**；
- **48 小时死人开关（Dead Man's Switch）** 与 **一键紧急物理粉碎重置（🚨 删库跑路）**。

即使服务器被全盘拖库或宿主机被他人获取，攻击者得到的也仅是一堆不可逆的随机加密字节。

---

## ✨ 十二大核心特性

1. 👥 **严格双人白名单体系 (Pair-Only)**：系统仅允许初始化配置的两名用户（`USER_A` 与 `USER_B`），从协议层封死任何未授权第三方的注册或探测。
2. ⏱️ **基于 TOTP 的动态密码认证 (`用户名@动态码`)**：彻底告别静态密码。密码格式为 `alice@123456`，首次登录生成高清晰度二维码，支持 Google Authenticator、苹果自带钥匙串、1Password、Bitwarden 扫码激活。
3. 🛡️ **WebCrypto AES-256-GCM 零知识端对端加密**：所有文字、图片、音视频语音与 ZIP 附件在离开发送端浏览器前在本地完成加密，服务端只转运乱码密文。
4. 🔥 **多档精细化阅后即焚 (Burn-After-Reading)**：支持即阅即焚、10秒、30秒、1分钟、5分钟、1小时、24小时多档设置。拆阅信封触发双向倒计时，归零后全员屏幕淡出粒子焚毁。
5. 🪓 **双遍随机覆写物理粉碎引擎 (`shredder.py`)**：删除文件不只是简单 `unlink`，而是采用 `os.urandom` 块数据覆写两遍后再截断删除，彻底防范底层磁盘恢复软件。
6. 🔄 **7 天滚动留存物理淘汰机制 (7-Day Rolling Retention)**：即使选择永久保存，最长物理留存期也限制在 7 天内。后台协程每分钟巡检并物理粉碎超期数据，确保客户端每次打开拉取轻量（<200KB），服务端磁盘永不膨胀。
7. ⏳ **48 小时无交互死人开关 (48-Hour Dead Man's Switch)**：若整套系统连续 48 小时内没有任何用户访问或交互，后台自动启动最高等级物理粉碎，清空所有数据并重置容器！
8. 🚨 **一键紧急自毁 (🚨 删库跑路gogogo)**：界面内置自毁控制台，二次确认后立即物理粉碎所有数据库、附件与 TOTP 秘钥，并在 1 秒内重启容器恢复出厂未激活态。
9. 🔑 **双方互信 TOTP 救援重置**：当一方更换手机丢失验证器时，另一方可在已登录面板中一键重置对方的 TOTP 绑定状态，且**完整保留双方所有聊天历史记录**。
10. 📎 **Gemini 风格富媒体托盘与引用回复**：截图直接 `Ctrl+V` 粘贴、多图排队预览、图文一体复合气泡打包发送；长按任意消息引用回复，气泡内平滑滚动定位与脉冲高亮。
11. 📱 **跨平台原生媒体导出与魔数嗅探**：集成 Web Share API，在 iPhone 上可将加密视频直接**一键保存至系统相册**；内置二进制文件头魔数嗅探（Magic-Bytes Sniffer），解决 ZIP 误下载为 `.dat` 的痛点。
12. 🔔 **标准 Web Push 系统级加密推送 (RFC 8030 VAPID)**：原生支持 iOS 16.4+ 主屏幕 PWA 锁屏点亮唤醒、Android 与桌面浏览器，推送内容零隐私泄露，配备推送设备管理面板。

---

## ⚠️ 关于身份验证器（Authenticator）兼容性避坑提示

> [!IMPORTANT]
> **请务必保持 `TOTP_INTERVAL=30`（默认推荐）**
> - 虽然 RFC 6238 规范允许自定义步长，但在实际移动生态中，**Google Authenticator（谷歌身份验证器）客户端会直接忽略二维码里的 60 秒参数，强制按 30 秒计算**，导致若服务端设置为 60s 时谷歌验证器必定验证失败！
> - 标准 30 秒步长拥有 100% 的行业全兼容性：支持 **Google Authenticator、苹果自带密码钥匙串、1Password、Bitwarden、微软 Authenticator、2FAS、YubiKey** 等。
> - 仅当双方均使用显式支持自定义周期的验证器（如 1Password、KeePassXC、2FAS）时才可调整为 60。

---

## 🚀 30 秒快速上手 (Docker Compose)

### 方案 1：标准 Docker Compose 部署（优先推荐）

1. **克隆项目源码：**
   ```bash
   git clone https://github.com/lucayunxiao/ironchat.git
   cd ironchat
   ```

2. **配置环境变量：**
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 设置双方用户名（其余所有加密密钥直接留空即可自动生成）：
   ```env
   USER_A=alice
   USER_B=bob
   # 就这么简单！所有安全密钥（SECRET_KEY、E2EE_MASTER_PASSPHRASE、E2EE_SALT）
   # 留空时系统会在首次启动时自动生成高强度随机密钥并固化保存。
   ```

3. **启动容器服务：**
   ```bash
   docker compose up -d
   ```

4. **打开聊天：**
   在浏览器中访问 `http://<您的服务器IP>:8088`。输入 `alice` 或 `bob`，即可呈现二维码，扫码绑定即可开启私密畅聊！

---

### 方案 2：Docker + Cloudflare Tunnel 整合部署（家庭 NAS 与私有云极简方案）

专为无公网 IP、无路由器端口映射的家庭私有云（Proxmox VE、群晖、Unraid、工控机）打造。

1. 在 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com/)（**Networks** -> **Tunnels**）中创建一个隧道；
2. 将公网域名（如 `chat.yourdomain.com`）指向服务：`http://ironchat:8088`，并勾选开启 **WebSockets**；
3. 将复制的隧道 Token 粘贴到 `.env` 文件末尾：
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   ```
4. 启动整合服务：
   ```bash
   docker compose -f deployments/docker-compose.cloudflare.yml up -d
   ```
您的私有聊天服务即刻通过 `https://chat.yourdomain.com` 全球安全直通，无需开放任何家庭路由器端口！

---

## ⚙️ 环境变量完整配置字典 (Environment Variables)

所有系统行为均通过根目录下的 `.env` 文件进行配置：

| 变量名 | 数据类型与功能解析 | 默认值 | 是否必填 |
| :--- | :--- | :--- | :--- |
| **`USER_A`** | 第一位合法用户的用户名（严格区分大小写，协议层拦截其他任何用户）。 | `alice` | **必填** |
| **`USER_B`** | 第二位合法用户的用户名（聊天对端账号）。 | `bob` | **必填** |
| **`TOTP_INTERVAL`** | TOTP 动态码刷新步长（秒）。**强烈推荐保持 30 秒** 以确保 Authenticator 全兼容。 | `30` | 可选 |
| **`SESSION_INACTIVITY_TIMEOUT`** | 用户会话无交互自动登出超时（秒，默认 86400 秒 = 24 小时）。到期后必须重新输入动态密码。 | `86400` | 可选 |
| **`DEAD_MAN_TIMEOUT`** | 全局 48 小时死人开关超时（秒）。连续 48 小时无任何交互，系统将自动物理粉碎并出厂重置！ | `172800` | 可选 |
| **`MESSAGE_RETENTION_SECONDS`** | 7 天滚动留存上限（秒）。超期消息由后台协程自动物理粉碎，确保数据轻量与磁盘整洁。 | `604800` | 可选 |
| **`SECRET_KEY`** | HTTP 会话 Cookie 签名私钥（HMAC-SHA256）。**支持直接留空**，启动时自动生成 64 位强随机密钥并固化。 | *(自动生成)* | 可选 |
| **`E2EE_MASTER_PASSPHRASE`** | 客户端 PBKDF2 WebCrypto AES-GCM 密钥派生主口令种子。**支持留空**，启动时自动生成并固化。 | *(自动生成)* | 可选 |
| **`E2EE_SALT`** | 客户端 PBKDF2 算法专属盐值（Salt）。**支持留空**，启动时自动生成并固化。 | *(自动生成)* | 可选 |
| **`APP_DOMAIN`** | 系统访问外部域名或内网 IP（用于 PWA 清单与提示引用）。 | `chat.example.com` | 可选 |
| **`VAPID_CLAIM_EMAIL`** | Web Push RFC 8292 协议管理员合规声明邮箱（仅用于推送通道握手标识，不发邮件）。 | `admin@example.com` | 可选 |
| **`PORT`** | 容器内部与宿主机暴露的 HTTP 监听端口。 | `8088` | 可选 |
| **`HOST`** | 绑定的网卡监听地址。 | `0.0.0.0` | 可选 |
| **`DATA_DIR`** | 容器内部存储 SQLite 数据库、状态文件与加密附件的绝对路径。 | `/app/data` | 可选 |
| **`CLOUDFLARE_TUNNEL_TOKEN`** | Cloudflare 隧道 Token（**仅方案 2 需要填写**，从 Zero Trust 后台获取）。 | *(无)* | 仅方案 2 必填 |

---

## 📱 移动端 PWA 安装体验（强烈推荐）

为了获得全屏沉浸体验与系统级锁屏推送：
- **苹果 iPhone**：使用 Safari 打开网址 -> 点击底部 **分享按钮** -> 点击 **添加到主屏幕** -> 从桌面打开图标并允许通知；
- **安卓 Android**：使用 Chrome 打开网址 -> 点击右上角菜单 **⋮** -> 选择 **安装应用** 或 **添加到主屏幕**。

---

## 📖 深入阅读与文档

- 📘 [详细部署指南（方案 1 与方案 2 每步操作）](docs/zh/DEPLOYMENT.md)
- 🛡️ [安全技术白皮书与威胁模型深度解析](docs/zh/ARCHITECTURE.md)
- 🔔 [Web Push 推送机制与 iOS 主屏幕配置指南](docs/zh/WEBPUSH_GUIDE.md)

---

## ⚖️ 开源协议

本项目基于 **GNU Affero General Public License v3.0 (AGPL-3.0)** 协议开源。详细条款见 [`LICENSE`](LICENSE)。
