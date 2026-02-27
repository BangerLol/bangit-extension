// Bangit - Login prompt modal

import { sendMessage, MessageTypes } from '../../core/rpc.js';

/**
 * Show login prompt modal
 */
export function showLoginPrompt() {
  const existingPrompt = document.querySelector('.bangit-login-prompt');
  if (existingPrompt) existingPrompt.remove();

  const logoUrl = chrome.runtime.getURL('media/bangitLogoNew-rounded-192x192.png');
  const prompt = document.createElement('div');
  prompt.className = 'bangit-login-prompt';
  prompt.innerHTML = `
    <div class="bangit-prompt-content">
      <img src="${logoUrl}" alt="Bangit" class="bangit-prompt-logo" />
      <h3>Login to Vote</h3>
      <button class="bangit-login-btn">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        Login with Twitter/X
      </button>
      <button class="bangit-close-btn">&times;</button>
    </div>
  `;

  prompt.querySelector('.bangit-login-btn').addEventListener('click', () => {
    sendMessage(MessageTypes.OPEN_LOGIN);
    prompt.remove();
  });

  prompt.querySelector('.bangit-close-btn').addEventListener('click', () => {
    prompt.remove();
  });

  // Close on overlay click
  prompt.addEventListener('click', (e) => {
    if (e.target === prompt) {
      prompt.remove();
    }
  });

  document.body.appendChild(prompt);
}
