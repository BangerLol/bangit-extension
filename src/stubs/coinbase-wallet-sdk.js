// Stub for @coinbase/wallet-sdk
// Bundled by @privy-io/react-auth but unused when externalWallets: { enabled: false }

export function createCoinbaseWalletSDK() {
  const provider = {
    request: async () => null,
    on: () => {},
    removeListener: () => {},
    disconnect: async () => {},
  };
  return {
    makeWeb3Provider: () => provider,
    getProvider: () => provider,
  };
}

export default { createCoinbaseWalletSDK };
