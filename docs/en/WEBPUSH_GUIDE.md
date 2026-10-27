# IronChat Web Push Notification Guide (RFC 8030 VAPID)

IronChat includes native, standard-compliant Web Push notifications that work across iOS, Android, and desktop browsers without requiring third-party messaging bridges.

---

## Zero-Leakage Privacy Policy
Push notifications sent by IronChat are strictly **content-free**:
- Notifications contain only a generic wake-up text: *"You received an encrypted message / 您收到一条端对端加密消息"*.
- **No plaintext, sender identity, or attachment data is ever passed through push relays** (Apple APNs, Google FCM, Microsoft WNS).

---

## Platform Support Matrix

| Platform | Requirements | Push Behavior |
| :--- | :--- | :--- |
| **iOS / iPadOS (16.4+)** | Must be added to Home Screen via Safari | Wakes lock screen, badge counters, system vibration |
| **Android (Chrome / Edge)** | Browser or installed PWA | Native notification banner and sound |
| **macOS (Safari / Chrome)** | macOS Ventura 13+ or desktop browser | Native Notification Center banner |
| **Windows / Linux** | Edge, Chrome, or Firefox | Native Action Center notification |

---

## Setting Up on Apple iOS (iPhone & iPad)

Apple requires Web Push applications to be added to the device Home Screen:

1. Open Safari on your iPhone and visit your IronChat URL (must be `https://`).
2. Log in using your dynamic password.
3. Tap the **Share** icon at the bottom of the Safari toolbar.
4. Tap **Add to Home Screen**.
5. Launch **IronChat** from your home screen.
6. When prompted: *"IronChat would like to send you notifications"*, tap **Allow**.

---

## Device Management & Troubleshooting

### Viewing Registered Devices
1. In the chat interface, tap the top-right three-dot menu `⋮`.
2. Select **Push Devices**.
3. View the list of active push endpoints with their detected device names and registration dates.
4. Tap **Send Test Push** to verify that notifications arrive immediately.
5. Tap **Unlink** next to any device to instantly revoke push permissions for that specific phone or browser.
