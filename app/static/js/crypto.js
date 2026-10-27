/**
 * WebCrypto AES-256-GCM End-to-End Encryption Module for IronChat.
 * All messages, images, audio, video, and files are encrypted in the browser before transmission.
 * The server acts strictly as a zero-knowledge ciphertext relay.
 */

class IronCrypto {
    constructor() {
        this.cryptoKey = null;
        this.salt = new TextEncoder().encode("ironchat-e2ee-salt-standard-2026");
    }

    setCustomSalt(saltStr) {
        if (saltStr && saltStr.length >= 8) {
            this.salt = new TextEncoder().encode(saltStr);
        }
    }

    /**
     * Derive a 256-bit AES-GCM key from user passphrase using PBKDF2.
     */
    async setPassphrase(passphrase, remember = true) {
        if (!passphrase) throw new Error("Passphrase cannot be empty / 加密口令不能为空");
        const enc = new TextEncoder();
        const baseKey = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(passphrase),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        this.cryptoKey = await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: this.salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );

        if (remember) {
            localStorage.setItem("ironchat_e2ee_pass", btoa(encodeURIComponent(passphrase)));
        }
        return true;
    }

    /**
     * Try to auto-restore remembered passphrase from localStorage.
     */
    async tryRestoreKey() {
        try {
            const saved = localStorage.getItem("ironchat_e2ee_pass");
            if (saved) {
                const pass = decodeURIComponent(atob(saved));
                await this.setPassphrase(pass, false);
                return true;
            }
        } catch {
            localStorage.removeItem("ironchat_e2ee_pass");
        }
        return false;
    }

    hasKey() {
        return this.cryptoKey !== null;
    }

    clearKey() {
        this.cryptoKey = null;
        localStorage.removeItem("ironchat_e2ee_pass");
    }

    /**
     * Encrypt UTF-8 text with AES-256-GCM.
     * Returns: { ciphertext: base64, iv: base64 }
     */
    async encryptText(plainText) {
        if (!this.cryptoKey) throw new Error("E2EE crypto key not ready / 端对端加密密钥未就绪");
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);

        const cipherBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-256-GCM" ? { name: "AES-GCM", iv: iv } : { name: "AES-GCM", iv: iv } },
            this.cryptoKey,
            encoded
        );

        return {
            ciphertext: this.arrayBufferToBase64(cipherBuffer),
            iv: this.arrayBufferToBase64(iv)
        };
    }

    /**
     * Decrypt AES-256-GCM ciphertext back to plain text.
     */
    async decryptText(ciphertextB64, ivB64) {
        if (!this.cryptoKey) throw new Error("E2EE crypto key not ready / 端对端加密密钥未就绪");
        const cipherBuffer = this.base64ToArrayBuffer(ciphertextB64);
        const iv = this.base64ToArrayBuffer(ivB64);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            this.cryptoKey,
            cipherBuffer
        );

        return new TextDecoder().decode(decryptedBuffer);
    }

    /**
     * Encrypt binary file (ArrayBuffer) with AES-256-GCM.
     * Returns: { encryptedBlob: Blob, iv: base64 }
     */
    async encryptBinary(arrayBuffer) {
        if (!this.cryptoKey) throw new Error("E2EE crypto key not ready / 端对端加密密钥未就绪");
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const cipherBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            this.cryptoKey,
            arrayBuffer
        );

        return {
            encryptedBlob: new Blob([cipherBuffer], { type: "application/octet-stream" }),
            iv: this.arrayBufferToBase64(iv)
        };
    }

    /**
     * Decrypt binary file back to plain ArrayBuffer.
     */
    async decryptBinary(arrayBuffer, ivB64) {
        if (!this.cryptoKey) throw new Error("E2EE crypto key not ready / 端对端加密密钥未就绪");
        const iv = this.base64ToArrayBuffer(ivB64);

        return await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            this.cryptoKey,
            arrayBuffer
        );
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

window.ironCrypto = new IronCrypto();
