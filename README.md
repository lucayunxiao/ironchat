<div align="center">

# 🔒 IronChat

### The Ultra-Private Two-Party Zero-Trust E2EE Messenger

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](deployments/docker-compose.yml)
[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](requirements.txt)
[![Security: AES-256-GCM](https://img.shields.io/badge/Security-AES--256--GCM-green.svg)](docs/en/ARCHITECTURE.md)
[![Web Push: RFC 8030](https://img.shields.io/badge/Web_Push-RFC_8030_VAPID-orange.svg)](docs/en/WEBPUSH_GUIDE.md)

[English](README.md) • [中文文档](README_zh.md) • [Deployment Guide](docs/en/DEPLOYMENT.md) • [Security Whitepaper](docs/en/ARCHITECTURE.md)

</div>

---

## 💡 Overview

**IronChat** is an open-source, ultra-private, zero-knowledge instant messaging application designed exclusively for **pairs** (couples, close family members, or confidential partners).

Unlike public messaging platforms that harbor data indefinitely, IronChat enforces a **strict two-party whitelist**, hardware-level client-side **AES-256-GCM end-to-end encryption**, **anti-forensic RAM-only message storage**, **per-second burn-after-reading countdowns**, an autonomous **48-hour dead man's switch**, and a physical **data shredder**.

The server acts as a blind, zero-knowledge ciphertext relay. If the host machine is seized or the database dumped, attackers recover only unreadable random bytes.

---

## ✨ Core Features

- 👥 **Strict Two-Party Whitelist (Pair-Only)**: The system permits exactly two configured usernames (`USER_A` and `USER_B`). All other registration or login attempts are rejected at the protocol layer.
- ⏱️ **Dynamic Password with TOTP (`username@code`)**: Replaces static passwords. Users log in with their dynamic TOTP code (e.g. `alice@839201`). Initial setup features crisp QR code provisioning compatible with Google Authenticator, Apple Passwords, 1Password, and Bitwarden.
- 🛡️ **WebCrypto AES-256-GCM End-to-End Encryption**: Text messages, photos, videos, audio voice notes, and file attachments are encrypted in the browser prior to transmission. The server cannot inspect plaintext or filenames.
- 🔥 **Multi-Tier Burn-After-Reading**: Configurable self-destruction timers (`Immediate`, `10s`, `30s`, `1m`, `5m`, `1h`, `24h`). Opening an envelope initiates a live synchronized countdown followed by smooth particle disintegration.
- 🪓 **Physical Data Shredder (`shredder.py`)**: Deleted messages and media attachments undergo DoD-inspired **double-pass random byte overwriting (`os.urandom`)** and filesystem sync before truncation and unlinking.
- 🔄 **7-Day Rolling Retention Policy**: Even messages marked as permanent are physically shredded after 7 days, maintaining an ultra-light message payload (<200KB) and preventing disk bloat.
- ⏳ **48-Hour Dead Man's Switch**: If both users are inactive for 48 consecutive hours (no requests, no messages, no active connections), the daemon assumes abandonment and executes an irreversible physical shredding of all databases and media.
- 🚨 **One-Click Panic Destruct ("删库跑路")**: Either user can trigger an emergency self-destruction from the UI. Shreds all databases, files, and TOTP enrollment secrets, rebooting the container into a factory clean state within 1 second.
- 🔑 **Peer TOTP Reset**: If one user loses their authenticator app or replaces their phone, the peer user can reset their TOTP binding from the authenticated UI **without losing any chat history**.
- 📎 **Gemini-Style Rich Media Tray & Quote Reply**: Paste screenshots directly with `Ctrl+V`, queue multiple attachments with thumbnail previews, and send composite text-and-media messages in a single bubble. Quote messages with smooth anchor jump and highlight animations.
- 📱 **Cross-Platform Native Media Exporter**: Integrates Web Share API to save encrypted videos directly into the **Apple Photos Album** on iOS, alongside a binary **Magic-Bytes Sniffer** ensuring ZIP archives never download as `.dat`.
- 🔔 **Standard Web Push Notifications (RFC 8030 VAPID)**: Native push support for iOS 16.4+ Home Screen PWAs (APNs), Android, and desktop browsers, featuring zero-leakage payload headers and a multi-device management console.

---

## ⚠️ Important Note on TOTP Interval (30s vs 60s)

> [!IMPORTANT]
> **Keep `TOTP_INTERVAL=30` (Default & Recommended)**
> - While RFC 6238 permits arbitrary time steps, **Google Authenticator (iOS & Android) completely ignores the `period=60` parameter in QR codes and forces a 30-second evaluation**, resulting in dynamic code verification failures!
> - Standard 30 seconds works universally across all authenticator apps: **Google Authenticator, Apple Passwords Keychain, 1Password, Bitwarden, Microsoft Authenticator, 2FAS, and YubiKey**.
> - Only configure `TOTP_INTERVAL=60` if both users strictly use authenticators that explicitly support custom periods (such as 1Password, KeePassXC, or 2FAS).

---

## 🚀 Quick Start (Docker Compose)

### Scheme 1: Standard Docker Deployment (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/lucayunxiao/ironchat.git
   cd ironchat
   ```

2. **Configure your environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to define your two usernames:
   ```env
   USER_A=alice
   USER_B=bob
   TOTP_INTERVAL=30
   SECRET_KEY=use-a-strong-random-secret-key-in-production
   ```

3. **Launch container:**
   ```bash
   docker compose up -d
   ```

4. **Access IronChat:**
   Open `http://<your-server-ip>:8088` in your browser. Enter `alice` or `bob` to scan your initial TOTP enrollment QR code!

---

### Scheme 2: Docker Compose + Cloudflare Tunnel (Zero Inbound Ports)

Ideal for home NAS (Synology, QNAP, Unraid) and Proxmox VE (PVE) without a public IP or port forwarding.

1. Create a tunnel in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) (**Networks** -> **Tunnels**).
2. Point your public hostname (e.g. `chat.yourdomain.com`) to `http://ironchat:8088` and enable **WebSockets**.
3. Add your tunnel token to `.env`:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   ```
4. Start the stack:
   ```bash
   docker compose -f deployments/docker-compose.cloudflare.yml up -d
   ```
Your private chat is immediately accessible via `https://chat.yourdomain.com` with free automated TLS and zero router ports exposed!

---

## 📱 Mobile PWA Installation (iOS & Android)

To enable background lock-screen push notifications and an immersive full-screen experience:

- **Apple iOS**: Open your URL in Safari -> Tap **Share** -> **Add to Home Screen** -> Launch from Home Screen and tap **Allow** for notifications.
- **Android**: Open in Chrome -> Tap **⋮** -> **Install Application** / **Add to Home Screen**.

---

## 📖 Detailed Documentation

- 📘 [Detailed Deployment Guide (Scheme 1 & Scheme 2)](docs/en/DEPLOYMENT.md)
- 🛡️ [Security Architecture & Threat Model Whitepaper](docs/en/ARCHITECTURE.md)
- 🔔 [Web Push Notification Configuration (iOS APNs / Android)](docs/en/WEBPUSH_GUIDE.md)

---

## ⚖️ License

Distributed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [`LICENSE`](LICENSE) for details.
