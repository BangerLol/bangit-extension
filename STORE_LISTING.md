# Bangit Chrome Web Store Listing

## Store Information

### Name
Bangit

### Short Description (132 chars max)
Vote on tweets to influence rankings and earn rewards.

### Detailed Description
Bangit adds upvote and downvote buttons directly to your X/Twitter feed. Express your opinion on tweets and help surface quality content.

**Features:**
- Upvote or downvote any tweet with a single click
- Adjustable voting power (1-20%) to control your influence
- Real-time impact scores show community consensus
- Earn BANG token rewards for participating
- Seamless Twitter/X authentication via Privy

**How It Works:**
1. Login with your X/Twitter account through the extension popup
2. Browse X/Twitter normally - voting buttons appear on every tweet
3. Click upvote or downvote to cast your vote
4. Watch real-time impact scores update as the community votes
5. Claim and stake rewards from the extension popup

**Privacy:**
- We only access X/Twitter pages to add voting UI
- Authentication is handled securely via Privy OAuth
- No personal data is sold or shared with third parties
- Vote data is stored on our secure backend servers

### Category
Social & Communication

### Language
English

---

## Required Assets

### Screenshots (Required: at least 1)
- Size: 1280x800 or 640x400 pixels
- Format: PNG or JPEG

**Recommended screenshots to create:**
1. X/Twitter feed showing the voting buttons on tweets
2. Extension popup showing user stats and voting power
3. Tweet with visible impact score after voting

### Promotional Tile (Optional)
- Small: 440x280 pixels
- Large: 920x680 pixels
- Marquee: 1400x560 pixels

---

## Permissions Justification

When submitting, you'll need to justify each permission. Use these explanations:

### Chrome Permissions (`permissions`)

#### `storage`
**Justification:** Required to save user authentication state and preferences locally, enabling persistent login sessions across browser restarts.

#### `identity`
**Justification:** Used by the Privy SDK to handle the Twitter OAuth authentication flow (opening the auth popup and receiving the callback).

#### `offscreen`
**Justification:** Creates a hidden DOM context for Privy SDK token refresh. The SDK requires a DOM to refresh JWT tokens silently — Chrome MV3 service workers don't have a DOM, so an offscreen document bridges this gap.

#### `alarms`
**Justification:** Schedule periodic token refresh checks in the background service worker. Chrome MV3 service workers are ephemeral, so alarms ensure authentication stays current.

### Host Permissions (`host_permissions`)

#### `https://x.com/*` and `https://twitter.com/*`
**Justification:** Required to inject the voting UI (upvote/downvote buttons) into the X/Twitter feed and read tweet IDs for the voting system.

#### `https://bangit-backend-production.up.railway.app/*`
**Justification:** Required to communicate with our backend API for processing votes, fetching vote data, and managing user rewards.

#### `https://auth.privy.io/*`
**Justification:** Complete the authentication flow — Privy's auth server handles token issuance and refresh.

### Externally Connectable (`externally_connectable`)

#### `https://bangit.xyz/*` and `https://www.bangit.xyz/*`
**Justification:** Allows the Bangit website to communicate with the installed extension (e.g., deep-link login, open extension popup). This is not a host permission — it only allows the listed origins to send messages to the extension via `chrome.runtime.sendMessage`.

---

## Privacy Policy

Privacy policy URL for Chrome Web Store submission: `https://bangit.gitbook.io/bangit-docs/privacy-policy`

---

## Submission Checklist

- [ ] Created screenshots (1280x800 or 640x400)
- [ ] Privacy policy live at https://bangit.gitbook.io/bangit-docs/privacy-policy
- [ ] Registered for Chrome Web Store developer account ($5 fee)
- [ ] Run `./package-extension.sh` to create ZIP file
- [ ] Test extension thoroughly before submission
- [ ] Verify all icons display correctly

---

## Upload Process

1. Go to: https://chrome.google.com/webstore/devconsole
2. Click "New Item"
3. Upload `bangit-extension.zip`
4. Fill in store listing details from above
5. Upload screenshots
6. Complete privacy practices section
7. Submit for review

**Review typically takes 1-3 business days.**
