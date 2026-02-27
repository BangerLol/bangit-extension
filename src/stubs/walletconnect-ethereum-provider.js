// Stub for @walletconnect/ethereum-provider
// Provides minimal mock implementation for Privy SDK compatibility
// This is safe because we use externalWallets: { enabled: false }

class EthereumProvider {
  constructor() {
    this.accounts = [];
    this.chainId = 1;
    this.connected = false;
  }

  static async init() {
    return new EthereumProvider();
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

export { EthereumProvider };
export const OPTIONAL_METHODS = [];
export const OPTIONAL_EVENTS = [];
export default EthereumProvider;
