// Minimal stub for @walletconnect/utils
// Provides empty implementations for methods that might be called during initialization

export const parseUri = () => ({});
export const formatUri = () => "";
export const isValidUrl = () => false;
export const isLocalhostUrl = () => false;
export const formatRelayRpcUrl = () => "";
export const isOnline = () => true;
export const isBrowser = () => true;
export const isNode = () => false;
export const isReactNative = () => false;
export const calcExpiry = () => 0;
export const formatAccountWithChain = () => "";
export const formatChainId = () => "";
export const parseChainId = () => ({ namespace: "", reference: "" });
export const parseAccountId = () => ({ chainId: "", address: "" });
export const getSdkError = (key) => ({ message: key, code: 0 });
export const getInternalError = (key) => ({ message: key, code: 0 });
export const isValidArray = () => false;
export const isValidObject = () => false;
export const isUndefined = (x) => x === undefined;
export const isValidString = () => false;
export const isValidChainId = () => false;
export const isValidAccountId = () => false;
export const isValidNamespaceKey = () => false;
export const isValidRequestParams = () => false;
export const isValidId = () => false;
export const isValidNamespaces = () => false;
export const isValidErrorCode = () => false;
export const isExpired = () => true;
export const hashMessage = () => "";
export const hashKey = () => "";
export const generateRandomBytes32 = () => "";
export const createDelayedPromise = () => ({ resolve: () => {}, reject: () => {}, done: () => Promise.resolve() });

export default {
  parseUri,
  formatUri,
  isValidUrl,
  getSdkError,
  getInternalError,
};
