# IronChat 生产环境部署指南

本指南详细介绍如何使用 Docker 快速部署 IronChat 私密双人加密聊天系统。

---

## 部署方案对比与选型

| 方案 | 推荐适用场景 | 核心优势 | 端口映射要求 |
| :--- | :--- | :--- | :--- |
| **方案 1：Docker Compose 标准部署（优先/通用）** | 云服务器 VPS、已有反代的主机、家庭局域网 | 启动极速，原生端口直出 (:8088)，方便对接各种现有网关 | 可选（如需外部直接访问需放行） |
| **方案 2：Docker + Cloudflare Tunnel 整合部署** | 家庭 NAS、Proxmox VE、极度重视安全防扫描的场景 | **零公网端口暴露、免公网 IP、自带权威 SSL 证书与全球 CDN 防护** | **完全不需要 (零端口暴露)** |

---

## 方案 1：Docker Compose 标准部署

如果您拥有公网 IP，或宿主机本地已装有 Nginx Proxy Manager (NPM)、Caddy、Traefik 等反向代理，推荐此方案。

### 第一步：克隆仓库并初始化配置
```bash
git clone https://github.com/lucayunxiao/ironchat.git
cd ironchat
cp .env.example .env
```

### 第二步：编辑 `.env` 环境变量
使用编辑器修改 `.env` 文件：
```env
# 1. 设置允许的两名用户（严格双人白名单）
USER_A=alice
USER_B=bob

# 2. TOTP 动态码步长（推荐保持 30 秒以确保 Authenticator 兼容性）
TOTP_INTERVAL=30

# 3. 会话签名与加密密钥（支持留空！留空时系统首次启动会自动生成高强度安全密钥并持久化保存）
SECRET_KEY=
E2EE_MASTER_PASSPHRASE=
E2EE_SALT=

# 4. 监听端口
PORT=8088
```

> [!IMPORTANT]
> **关于身份验证器（Authenticator）兼容性特别说明 (30s vs 60s)**：
> 我们强烈推荐保持 `TOTP_INTERVAL=30`（默认值）。虽然 RFC 规范允许自定义步长，但**包括 Google Authenticator 在内的绝大多数主流手机客户端会直接忽略 `period=60` 参数，强制按 30 秒计算**，导致若服务端配置为 60s 时 Google Authenticator 扫码后必然验证失败！仅当双方均使用显式支持自定义周期的客户端（如 1Password、KeePassXC、2FAS）时才可调整为 60。

### 第三步：一键构建并拉起容器
```bash
docker compose up -d
```

检查容器运行状态与健康检查：
```bash
docker compose ps
docker compose logs -f
```

在浏览器中打开 `http://<您的服务器IP>:8088` 即可开始使用。

---

## 方案 2：Docker Compose + Cloudflare Tunnel 整合部署（家庭与私有云极简方案）

专为部署在家庭 NAS（群晖/威联通/Unraid）、家庭 All-in-One 虚拟化系统（Proxmox VE LXC）、工控机或树莓派量身打造，**无需公网 IPv4 地址，路由器无需做任何端口映射**。

### 前置准备
1. 拥有一个 Cloudflare 免费账号，并且域名托管在 Cloudflare DNS；
2. 登录 [Cloudflare Zero Trust 控制台](https://one.dash.cloudflare.com/) -> **Networks** -> **Tunnels**。

### 第一步：创建 Cloudflare Tunnel
1. 点击 **Add a Tunnel**，选择 **Cloudflared** 并为隧道命名（如 `ironchat-home`）；
2. 在安装命令步骤中，复制 `--token` 后面的长字符串 Token；
3. 在 **Public Hostname** 配置页：
   - 子域名填写：`chat`（即绑定为 `chat.yourdomain.com`）；
   - Service 服务类型选择：`HTTP`，URL 填入：`ironchat:8088`；
   - 在下方 **Additional application settings** -> **HTTP Settings** 中，务必勾选开启 **WebSockets**。

### 第二步：配置本地 `.env`
```bash
cp .env.example .env
```
在 `.env` 中填入两名用户名以及复制的 Tunnel Token：
```env
USER_A=alice
USER_B=bob
TOTP_INTERVAL=30
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYW...复制的Cloudflare隧道Token...
```

### 第三步：启动整合容器服务
```bash
docker compose -f deployments/docker-compose.cloudflare.yml up -d
```

此时 `cloudflared` 容器会自动与 Cloudflare 全球边缘节点建立出方向加密通道，无需开放任何家庭防火墙端口，您即可通过 `https://chat.yourdomain.com` 全球安全畅连！

---

## 移动端 PWA 安装体验指南 (iOS 与 Android)

为了获得原生 App 般的全屏体验与系统级加密锁屏推送，强烈建议将网页添加至主屏幕：

### 苹果 iOS (iOS 16.4 及以上)
1. 在 iPhone 自带 Safari 浏览器中打开您的聊天网址；
2. 点击底部的 **分享按钮**（带向上箭头的方框）；
3. 向上滑动并选择 **“添加到主屏幕” (Add to Home Screen)**；
4. 从手机桌面打开 **IronChat** 图标，在弹出的系统提示中允许通知权限。

### 安卓 Android
1. 在手机 Chrome 浏览器中打开聊天网址；
2. 点击右上角菜单（三个点） -> 选择 **“安装应用”** 或 **“添加到主屏幕”**；
3. 打开桌面图标并允许通知权限。

---

## 维护与备份

### 升级更新
```bash
git pull
docker compose down
docker compose up -d --build
```

### 数据备份
所有 SQLite 数据库、TOTP 激活记录与加密附件均保存在 `./data` 目录中：
```bash
tar -czvf ironchat_backup_$(date +%F).tar.gz data/
```
