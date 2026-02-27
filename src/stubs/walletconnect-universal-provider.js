// Stub for @walletconnect/universal-provider
// Provides minimal mock implementation for Privy SDK compatibility
// This is safe because we use externalWallets: { enabled: false }

class UniversalProvider {
  constructor() {
    this.session = null;
    this.namespaces = {};
  }

  static async init() {
    return new UniversalProvider();
  }

  async connect() {
    throw new Error("WalletConnect is disabled");
  }

  async disconnect() {}
  async request() { return null; }
  on() { return this; }
  off() { return this; }
  removeListener() { return this; }
  emit() { return false; }
}

export { UniversalProvider };
export default UniversalProvider;
