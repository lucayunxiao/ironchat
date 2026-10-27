# IronChat Security Architecture & Threat Model Whitepaper

This document details the architectural design, cryptographic primitives, and threat model of IronChat.

---

## 1. System Topology & Zero-Knowledge Architecture

```
[ Client A (Browser / PWA) ]              [ Client B (Browser / PWA) ]
      │                                                ▲
      │ (1) AES-256-GCM Local Hardware Encryption      │ (5) AES-256-GCM Local Decryption
      ▼                                                │
[ Cloudflare Tunnel / Reverse Proxy (TLS 1.3) ] ───────┘
      │
      │ Encrypted Ciphertexts & Random IVs Only
      ▼
[ IronChat FastAPI Backend ]
      │
      ├── SQLite WAL Storage (Zero-Knowledge Ciphertexts)
      ├── BurnEngine (Per-second Countdown & 7-Day Rolling Shredder)
      ├── DeadManDaemon (48-Hour Inactivity Auto-Destruct)
      └── Physical Shredder Engine (Multi-pass Random Overwrite + Unlink)
```

### Core Cryptographic Primitives
- **Symmetric Encryption**: WebCrypto `AES-256-GCM` with random 96-bit (12-byte) initialization vectors (IVs) generated per message and per file chunk via `crypto.getRandomValues()`.
- **Key Derivation**: PBKDF2 with HMAC-SHA256, 100,000 iterations, and a unique cryptographic salt.
- **Session Tokens**: Signed using HMAC-SHA256 with server-side tamper detection and strict 24-hour inactivity timeout.
- **Authentication**: RFC 6238 standard TOTP dynamically evaluated in combination with username (`username@code`).

---

## 2. Threat Model & Security Defenses

### Threat 1: Network Eavesdropping & Interception
- **Attacker**: Rogue Wi-Fi, ISP, state-level network snooper, or CDN edge compromise.
- **Defense**: Double-layer encryption. Traffic is wrapped in standard TLS 1.3, and the payload itself is end-to-end encrypted with AES-256-GCM before it ever touches the browser network stack.

### Threat 2: Server Breach / Database Seizure
- **Attacker**: Host server compromised, database leaked, or physical disks seized.
- **Defense**: **Zero-Knowledge Design**.
  - The server never receives, stores, or handles plain text or client encryption passphrases.
  - The SQLite database contains only Base64-encoded ciphertexts, randomized IVs, and timestamps.
  - File attachments stored on disk are AES-GCM encrypted binary blobs.
  - Seizing the database yields nothing readable without the client-side master key.

### Threat 3: Client Device Forensic Inspection (Anti-Forensic Storage)
- **Attacker**: A user's phone or computer is physically inspected or scanned using data recovery tools.
- **Defense**: **Zero-Disk Footprint (RAM-Only Messages)**.
  - Decrypted messages, plaintext, and files are held strictly in JavaScript memory (`Map()`).
  - No messages, chats, or unencrypted attachments are EVER written to `localStorage`, `sessionStorage`, `IndexedDB`, or WebSQL.
  - Closing the browser tab or killing the PWA completely purges decrypted messages from RAM.

### Threat 4: Data Permanence & Forensic Drive Recovery
- **Attacker**: Recovering deleted messages from server storage using block-level undelete tools.
- **Defense**: **Physical Data Shredder (`shredder.py`)**.
  - When messages burn, recall, or age out, the backend doesn't merely call `os.unlink()`.
  - It overwrites the entire file space twice with cryptographically random bytes (`os.urandom()`) and calls `os.fsync()`, then truncates the file to 0 bytes before unlinking.

---

## 3. Autonomous Destruction Mechanisms

### 7-Day Rolling Retention
- Even if a message is set to keep indefinitely, its maximum physical retention is hard-capped at 7 days.
- The `BurnEngine` daemon scans every 60 seconds and permanently shreds expired messages and their media attachments, preventing database bloat.

### 48-Hour Dead Man's Switch
- The backend tracks a persistent `last_interaction` timestamp across both users.
- If no user sends a message, visits the site, or maintains an active connection for 48 consecutive hours, the `DeadManDaemon` assumes the instance has been abandoned or compromised and executes an emergency wipe.

### Emergency Panic Destruct (🚨 删库跑路)
- Either user can trigger this from the UI.
- Broadcasts instant wipe signal to all connected clients.
- Overwrites and shreds all databases, media files, and TOTP enrollment secrets.
- Reboots the container into a fresh, unactivated factory state.
