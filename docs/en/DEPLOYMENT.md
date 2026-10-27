# IronChat Production Deployment Guide

This guide provides step-by-step instructions for deploying IronChat using Docker.

---

## Deployment Schemes Overview

| Scheme | Recommended Environment | Key Advantages | Port Forwarding Needed? |
| :--- | :--- | :--- | :--- |
| **Scheme 1: Docker Compose (Standard)** | Cloud VPS, LAN, existing Reverse Proxy | Quickest setup, native port mapping (:8088) | Optional (for external access) |
| **Scheme 2: Docker + Cloudflare Tunnel** | Home NAS, Proxmox VE (PVE), Private LAN | **Zero port exposure, no public IP needed, free auto-SSL, DDoS protection** | **No (0 ports exposed)** |

---

## Scheme 1: Docker Compose Standard Deployment

Ideal if you have a public server or an existing reverse proxy (such as Nginx Proxy Manager, Caddy, or Traefik).

### Step 1: Clone Repository & Create Environment Configuration
```bash
git clone https://github.com/lucayunxiao/ironchat.git
cd ironchat
cp .env.example .env
```

### Step 2: Configure Environment Variables
Edit `.env` using your preferred editor (`nano .env` or `vim .env`):
```env
# 1. Set the two allowed usernames
USER_A=alice
USER_B=bob

# 2. TOTP Dynamic Interval (Keep 30 for universal compatibility)
TOTP_INTERVAL=30

# 3. Security Credentials (Leave blank to automatically generate secure keys!)
SECRET_KEY=
E2EE_MASTER_PASSPHRASE=
E2EE_SALT=

# 4. Storage & Port
PORT=8088
```

> [!IMPORTANT]
> **Authenticator Compatibility Notice (30s vs 60s)**:
> We strongly recommend keeping `TOTP_INTERVAL=30`. Most mainstream mobile authenticator apps (especially **Google Authenticator**) ignore the `period=60` parameter in `otpauth://` URIs and hardcode a 30-second window, causing dynamic code mismatches. Only set this to `60` if both users use authenticators with explicit custom-period support (such as 1Password, KeePassXC, or 2FAS).

### Step 3: Build and Launch Container
```bash
docker compose up -d
```

Verify that the container is running and healthy:
```bash
docker compose ps
docker compose logs -f
```

Access the application in your browser: `http://<your-server-ip>:8088`.

---

## Scheme 2: Docker Compose + Cloudflare Tunnel (Zero-Port Exposure)

Ideal for home servers (Proxmox VE, Synology, Unraid, Raspberry Pi) without a static public IPv4 address or open router ports.

### Prerequisites
- A Cloudflare account and a registered domain on Cloudflare DNS.
- Access to the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) -> **Networks** -> **Tunnels**.

### Step 1: Create a Cloudflare Tunnel
1. Go to **Zero Trust Dashboard** -> **Networks** -> **Tunnels** -> **Create a Tunnel**.
2. Select **Cloudflared** and name your tunnel (e.g. `ironchat-home`).
3. Under the installation command step, copy the tunnel token (the long string following `--token`).
4. Under the **Public Hostname** tab:
   - Subdomain: `chat` (e.g. `chat.yourdomain.com`)
   - Service: Type `HTTP`, URL: `ironchat:8088`
   - Under **Additional application settings** -> **HTTP Settings**, enable **WebSockets**.

### Step 2: Configure `.env`
```bash
cp .env.example .env
```
Append your Cloudflare Tunnel token:
```env
USER_A=alice
USER_B=bob
TOTP_INTERVAL=30
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYW...your-cloudflare-tunnel-token...
```

### Step 3: Launch with Cloudflare Tunnel Sidecar
```bash
docker compose -f deployments/docker-compose.cloudflare.yml up -d
```

The `cloudflared` container will automatically establish an outbound secure TLS tunnel to Cloudflare's global edge network. Your service is now live at `https://chat.yourdomain.com` without opening a single inbound port on your router!

---

## Installing as a Mobile PWA (iOS & Android)

For the best experience (including system-level encrypted push notifications and full-screen view):

### Apple iOS (iOS 16.4+)
1. Open Safari and navigate to `https://chat.yourdomain.com`.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Open **IronChat** from your home screen. When prompted, allow push notification permissions.

### Android
1. Open Google Chrome and navigate to `https://chat.yourdomain.com`.
2. Tap the top-right three dots menu -> **Install application** or **Add to Home screen**.
3. Accept push notification permissions when prompted.

---

## Updating & Maintenance

### Pull Latest Code & Restart
```bash
git pull
docker compose down
docker compose up -d --build
```

### Backup Data
All database records and encrypted media reside in `./data`:
```bash
tar -czvf ironchat_backup_$(date +%F).tar.gz data/
```
