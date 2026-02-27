# Bangit Chrome Extension

Vote on tweets to influence rankings and earn BANG token rewards.

## Trust & Transparency

This extension is **fully open source** and designed to be verifiable. You should not need to trust us — you can verify everything yourself.

- **[PERMISSIONS.md](PERMISSIONS.md)** — Every Chrome permission explained and justified
- **[SECURITY.md](SECURITY.md)** — Vulnerability disclosure policy
- **[LICENSE](LICENSE)** — MIT License

### Verify the Published Build

The published Chrome Web Store extension is built from this exact source code. You can verify this yourself:

```bash
git clone https://github.com/bangit-xyz/bangit-extension
cd bangit-extension
git checkout v1.3.3   # match the published version
./scripts/verify-build.sh
```

Compare the output against the `SHA256SUMS` file attached to the [GitHub Release](https://github.com/bangit-xyz/bangit-extension/releases).

**Compare against your installed extension:**
1. Go to `chrome://extensions`, find Bangit, note the extension ID
2. Run: `./scripts/verify-build.sh ~/.config/google-chrome/Default/Extensions/<ID>/<version>/`

### Release Process

Each release:
1. Code is tagged in git (e.g., `v1.3.3`)
2. GitHub Actions builds from the tag using a pinned Bun version
3. Build artifact SHA256 hashes are published in the release
4. The same artifacts are uploaded to the Chrome Web Store

You can verify any release by checking out its tag and building.

## Build from Source

**Prerequisites**: [Bun](https://bun.sh) 1.3.3

```bash
bun install --frozen-lockfile
bun run build
```

This produces:
| File | Source | Description |
|------|--------|-------------|
| `content.js` | `src/content/` | Injected into twitter.com/x.com — vote buttons, feed, sidebar |
| `popup.js` | `src/popup/` | Extension popup — dashboard, rewards, staking |
| `options.js` | `src/auth/` | Authentication page (Privy Twitter OAuth) |
| `offscreen.js` | `src/offscreen/` | Background token refresh (Privy SDK requires DOM) |
| `vendor.js` | `node_modules` | Shared dependencies for options + offscreen |
| `background.js` | — | Service worker (hand-written, not built) |

### Load as Unpacked Extension

1. Build the extension (see above)
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` directory

### Watch Mode

```bash
bun run watch
```

## Architecture

```
src/
├── content/          # Content script injected into Twitter
│   ├── core/         # State, RPC, lifecycle, config
│   ├── features/     # Lazy-loaded feature modules
│   │   ├── tweets/   # Vote button injection
│   │   ├── voting/   # Power selector, vote submission
│   │   ├── feed/     # Bangit feed tab in timeline
│   │   ├── sidebar/  # Sidebar buttons
│   │   └── modals/   # Performance, rewards, sybil modals
│   └── index.js      # Entry point
├── popup/            # React popup (dashboard)
├── auth/             # React options page (Privy auth)
├── offscreen/        # DOM context for token refresh
└── stubs/            # Stubs for unused Privy sub-dependencies
```

## Dependencies

All dependencies are pinned to exact versions in `package.json` and locked via `bun.lock`.

| Dependency | Purpose |
|-----------|---------|
| `@privy-io/react-auth` | Twitter OAuth authentication |
| `react` / `react-dom` | Popup and auth page UI |
| `socket.io-client` | Real-time vote/reward updates |

Dev dependencies are build-time only and not included in the extension.

## Security

- **Content Security Policy**: `script-src 'self'` — no remote code execution
- **Minimal permissions** — see [PERMISSIONS.md](PERMISSIONS.md)
- **No `<all_urls>`** — only runs on twitter.com/x.com and our API
- **No eval/inline scripts** — enforced by CSP
- **Reproducible builds** — verify with `./scripts/verify-build.sh`

Found a vulnerability? See [SECURITY.md](SECURITY.md).
