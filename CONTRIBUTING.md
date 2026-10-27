# Contributing to IronChat

Thank you for your interest in improving IronChat!

## Core Design Principles
When submitting PRs or issues, please ensure changes adhere to our core philosophy:
- **Pair-Only Architecture**: IronChat is intentionally restricted to two users. Features attempting to convert it into a multi-user group chat will be rejected.
- **Zero-Knowledge Encryption**: The server must never have access to private keys, master passphrases, or plain text messages.
- **Anti-Forensic Ephemeral Storage**: Data must not persist indefinitely. Shredding and deletion mechanisms must remain physically unrecoverable.
- **Bilingual Consistency**: Any UI additions must include both English and Simplified Chinese translations in `i18n.js`.
- **Zero Hardcoded Secrets**: Everything must remain fully configurable via environment variables.

## Development Workflow
1. Fork the repository and create your feature branch: `git checkout -b feature/amazing-feature`.
2. Install dependencies: `pip install -r requirements.txt`.
3. Run test suite: `pytest tests/`.
4. Run sanitization scanner to verify no secrets or private IP addresses were introduced.
5. Submit a pull request.
