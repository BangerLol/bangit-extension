# Extension Permissions Explained

Every permission requested by Bangit is listed here with its justification. We follow the principle of least privilege — we only request what's strictly necessary.

## Chrome Permissions (`permissions`)

| Permission | Why It's Needed |
|-----------|-----------------|
| `storage` | Store authentication tokens and user preferences locally so you stay logged in between browser sessions. No data leaves Chrome through this API. |
| `identity` | Used by the Privy SDK to handle the Twitter OAuth authentication flow (opening the auth popup and receiving the callback). |
| `offscreen` | Creates a hidden DOM context for Privy SDK token refresh. The Privy SDK requires a DOM to refresh JWT tokens silently — Chrome MV3 service workers don't have a DOM, so an offscreen document bridges this gap. |
| `alarms` | Schedule periodic token refresh checks in the background service worker. Chrome MV3 service workers are ephemeral, so alarms ensure authentication stays current. |

## Host Permissions (`host_permissions`)

| Host | Why It's Needed |
|------|-----------------|
| `https://x.com/*` | Inject the content script that adds vote buttons, the Bangit feed tab, and sidebar UI to Twitter/X. |
| `https://twitter.com/*` | Same as above — Twitter's legacy domain still redirects and some users access it directly. |
| `https://bangit-backend-production.up.railway.app/*` | Communicate with the Bangit API: submit votes, fetch feed rankings, load user profile/rewards, WebSocket real-time updates. |
| `https://auth.privy.io/*` | Complete the authentication flow — Privy's auth server handles token issuance and refresh. |

## Content Security Policy

```
script-src 'self'; object-src 'self'; frame-ancestors 'none';
```

- **`script-src 'self'`**: Only scripts bundled in the extension can execute. No remote scripts, no `eval()`, no inline scripts.
- **`object-src 'self'`**: No external plugins or embeds.
- **`frame-ancestors 'none'`**: Extension pages cannot be embedded in frames (clickjacking protection).

## Externally Connectable (`externally_connectable`)

| Origin | Why It's Needed |
|--------|-----------------|
| `https://bangit.xyz/*` | Allows the Bangit website to communicate with the installed extension (e.g., deep-link login, open extension popup). |
| `https://www.bangit.xyz/*` | Same as above for the www subdomain. |

## What We Do NOT Request

| Permission | Why We Don't Need It |
|-----------|---------------------|
| `tabs` | We don't read your browsing history or tab URLs. |
| `history` | We never access your browsing history. |
| `cookies` | We use `chrome.storage` instead, which is extension-scoped. |
| `webRequest` / `declarativeNetRequest` | We don't intercept, modify, or block any network requests. |
| `clipboardRead/Write` | We never access your clipboard. |
| `<all_urls>` | We only run on twitter.com/x.com and our own API — never on other sites. |
