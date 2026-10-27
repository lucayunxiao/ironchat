# Security Policy

## Threat Model & Principles
IronChat is architected with a **Zero-Knowledge, Pair-Only, Ephemeral Security Model**:
1. All plain text messages and media files are encrypted in the client browser using WebCrypto `AES-256-GCM` prior to network transit.
2. The server acts strictly as a blind ciphertext router and has zero capability to decrypt or inspect message payloads or filenames.
3. Disk storage on the server uses multi-pass random data overwriting before physical unlinking (`shredder.py`).
4. Client browsers do not persist decrypted messages to disk (RAM-only message stores).

## Reporting a Vulnerability
If you discover a potential security vulnerability in IronChat, please do **NOT** open a public issue. Instead, report it privately via GitHub Security Advisories or reach out to the project maintainers.

We appreciate responsible disclosure and will respond within 48 hours.
