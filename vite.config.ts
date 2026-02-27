import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

const target = process.env.BUILD_TARGET;

// Stub out unused heavy dependencies that Privy bundles but we don't need.
// WalletConnect / Coinbase: externalWallets: { enabled: false }
// Captcha: captchaEnabled: false — stubbing eliminates remote URLs at source
const unusedDependencyStubs: Record<string, string> = {
  "@walletconnect/ethereum-provider": resolve(__dirname, "src/stubs/walletconnect-ethereum-provider.js"),
  "@walletconnect/universal-provider": resolve(__dirname, "src/stubs/walletconnect-universal-provider.js"),
  "@walletconnect/modal": resolve(__dirname, "src/stubs/empty.js"),
  "@walletconnect/utils": resolve(__dirname, "src/stubs/walletconnect-utils.js"),
  "@walletconnect/jsonrpc-utils": resolve(__dirname, "src/stubs/empty.js"),
  "@walletconnect/sign-client": resolve(__dirname, "src/stubs/empty.js"),
  "@walletconnect/core": resolve(__dirname, "src/stubs/empty.js"),
  "@web3modal/wagmi": resolve(__dirname, "src/stubs/empty.js"),
  // Coinbase Wallet SDK - unused when externalWallets: { enabled: false }
  "@coinbase/wallet-sdk": resolve(__dirname, "src/stubs/coinbase-wallet-sdk.js"),
  // Captcha packages - remote URLs (challenges.cloudflare.com, js.hcaptcha.com) originate here
  "@hcaptcha/react-hcaptcha": resolve(__dirname, "src/stubs/empty.js"),
  "@marsidev/react-turnstile": resolve(__dirname, "src/stubs/react-turnstile.js"),
};

// Remote URLs that need to be stripped for Chrome Web Store compliance (Manifest V3)
// These are from Privy's captcha and wallet integrations which we disable but still get bundled
// Use local stub files to avoid noisy console errors while still blocking remote scripts
const DISABLED_BASE_URL = "https://localhost.invalid/";
const DISABLED_REMOTE_URL = `${DISABLED_BASE_URL}disabled-remote.js`;
const DISABLED_TELEGRAM_URL = `${DISABLED_BASE_URL}disabled-telegram.js`;
const DISABLED_HCAPTCHA_URL = `${DISABLED_BASE_URL}disabled-hcaptcha.js`;
const URLS_TO_STRIP = [
  // Captcha providers
  "https://challenges.cloudflare.com/turnstile/v0/api.js",
  "https://js.hcaptcha.com/1/api.js",
  "https://js.hcaptcha.com",
  // WalletConnect (disabled but bundled)
  "https://explorer-api.walletconnect.com",
  "https://api.web3modal.org",
  "https://relay.walletconnect.com",
  "wss://relay.walletconnect.com",
  // Coinbase Pay (disabled but bundled)
  "https://pay.coinbase.com",
];

// Dynamic script patterns that use template literals (regex-based stripping)
// These are constructed at runtime from variables, so we need regex to catch them
const DYNAMIC_SCRIPT_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  // Telegram OAuth login script: `${o}/js/telegram-login.js`
  {
    pattern: /`\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}\/js\/telegram-login\.js`/g,
    replacement: JSON.stringify(DISABLED_TELEGRAM_URL),
    description: "Telegram login script",
  },
  // hCaptcha secure API: `${i}/1/secure-api.js?onload=${...}`
  {
    pattern: /`\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}\/1\/secure-api\.js\?onload=\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}`/g,
    replacement: JSON.stringify(DISABLED_HCAPTCHA_URL),
    description: "hCaptcha secure API",
  },
  // hCaptcha regular API: `${i}/1/api.js?onload=${...}`
  {
    pattern: /`\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}\/1\/api\.js\?onload=\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}`/g,
    replacement: JSON.stringify(DISABLED_HCAPTCHA_URL),
    description: "hCaptcha API",
  },
  // hCaptcha custom scriptSource: `${l}?onload=${...}` (when scriptSource option is provided)
  {
    pattern: /`\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}\?onload=\$\{[a-zA-Z_$][a-zA-Z0-9_$]*\}`/g,
    replacement: JSON.stringify(DISABLED_HCAPTCHA_URL),
    description: "hCaptcha custom scriptSource",
  },
];

// Patterns for Privy's ClientAnalytics telemetry that uses dynamic script execution.
// The SDK bundles an entire analytics library as a string, then injects it via:
//   const n = document.createElement("script");
//   n.textContent = BLe; // BLe = '!function(e,t){...ClientAnalytics...}'
//   document.head.appendChild(n);
// This is functionally equivalent to eval() and will be flagged by Chrome Web Store review.
const CLIENT_ANALYTICS_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  // Neutralize the ClientAnalytics bundle string (assigned to a variable like BLe/nAe)
  // Match: variable = '!function(e,t){..."ClientAnalytics"...}' (the entire ~84KB inline bundle)
  // The string ends with a comma (part of a var declaration sequence), not a semicolon
  {
    pattern: /(\w+)\s*=\s*'!function\(e,t\)\{[^']*ClientAnalytics[^']*'/g,
    replacement: '$1 = ""',
    description: "ClientAnalytics inline bundle string",
  },
  // Neutralize the script injection: n.textContent = BLe, n.type = "text/javascript", document.head.appendChild(n)
  // Replace the entire injection block with a no-op
  {
    pattern: /const\s+(\w+)\s*=\s*document\.createElement\("script"\);\s*\1\.textContent\s*=\s*\w+,\s*\1\.type\s*=\s*"text\/javascript",\s*document\.head\.appendChild\(\1\)/g,
    replacement: 'void 0 /* ClientAnalytics script injection stripped for MV3 compliance */',
    description: "ClientAnalytics script injection",
  },
];

// Plugin to strip remote URLs from bundled code to avoid Chrome Web Store rejection
function stripRemoteUrls(): Plugin {
  return {
    name: "strip-remote-urls",
    generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (!chunk || chunk.type !== "chunk") continue;

        let modified = false;

        // Strip static URLs
        for (const url of URLS_TO_STRIP) {
          if (chunk.code.includes(url)) {
            // Use a valid chrome-extension URL so URL() parsing doesn't throw at runtime.
            chunk.code = chunk.code.replaceAll(url, DISABLED_REMOTE_URL);
            modified = true;
          }
        }

        // Strip dynamic script patterns (template literals)
        for (const { pattern, replacement, description } of DYNAMIC_SCRIPT_PATTERNS) {
          if (pattern.test(chunk.code)) {
            // Reset regex lastIndex since we're using global flag
            pattern.lastIndex = 0;
            chunk.code = chunk.code.replace(pattern, replacement);
            console.log(`  Stripped dynamic pattern (${description}) from ${fileName}`);
            modified = true;
          }
        }

        // Strip ClientAnalytics telemetry (inline script execution = eval equivalent)
        for (const { pattern, replacement, description } of CLIENT_ANALYTICS_PATTERNS) {
          if (pattern.test(chunk.code)) {
            pattern.lastIndex = 0;
            chunk.code = chunk.code.replace(pattern, replacement);
            console.log(`  Stripped ClientAnalytics (${description}) from ${fileName}`);
            modified = true;
          }
        }

        if (modified) {
          console.log(`  Stripped remote URLs from ${fileName}`);
        }
      }
    },
  };
}

// Build configurations for different targets
const configs: Record<string, ReturnType<typeof defineConfig>> = {
  // Background service worker - ESM format with Socket.IO bundled in
  background: defineConfig({
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: resolve(__dirname, "src/background/index.js"),
        formats: ["es"],
        fileName: () => "background.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  }),

  // Content script - IIFE format required for Chrome MV3 content scripts
  content: defineConfig({
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: resolve(__dirname, "src/content/index.js"),
        name: "BangitContent",
        formats: ["iife"],
        fileName: () => "content.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
        treeshake: {
          moduleSideEffects: false,
        },
      },
    },
  }),

  // Popup + Options + Offscreen - shared multi-entry build with vendor chunk extraction
  // All three are extension pages (ESM supported in MV3). A single build with manualChunks
  // extracts shared node_modules (React, Privy SDK, etc.) into vendor.js.
  privy: defineConfig({
    plugins: [react(), nodePolyfills(), stripRemoteUrls()],
    publicDir: false,
    resolve: {
      alias: unusedDependencyStubs,
    },
    build: {
      outDir: "dist",
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: {
          popup: resolve(__dirname, "src/popup/index.jsx"),
          options: resolve(__dirname, "src/auth/index.jsx"),
          offscreen: resolve(__dirname, "src/offscreen/index.jsx"),
        },
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        output: {
          chunkFileNames: "[name].js",
          manualChunks(id) {
            if (id.includes("node_modules")) {
              return "vendor";
            }
          },
        },
        treeshake: {
          moduleSideEffects: false,
        },
      },
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  }),
};

const selected = configs[target!];
if (target && !selected) {
  throw new Error(`Unknown BUILD_TARGET: "${target}". Valid targets: ${Object.keys(configs).join(", ")}`);
}
export default selected || configs.content;
