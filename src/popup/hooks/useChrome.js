// Chrome extension message passing utilities

export function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

export function getAuthStatus() {
  return sendMessage({ type: 'GET_AUTH_STATUS' });
}

export function setAuth(authData) {
  return sendMessage({ type: 'SET_AUTH', ...authData });
}

export function logout() {
  return sendMessage({ type: 'LOGOUT' });
}

export function getAccountData() {
  return sendMessage({ type: 'GET_ACCOUNT_DATA' });
}

export function getInviteDetails(inviteId) {
  return sendMessage({ type: 'GET_INVITE_DETAILS', inviteId });
}

export function claimRewards() {
  return sendMessage({ type: 'CLAIM_REWARDS' });
}

export function claimAndStake() {
  return sendMessage({ type: 'CLAIM_AND_STAKE' });
}

export function claimVested() {
  return sendMessage({ type: 'CLAIM_VESTED' });
}

export function openExternalUrl(url) {
  return chrome.tabs.create({ url });
}
