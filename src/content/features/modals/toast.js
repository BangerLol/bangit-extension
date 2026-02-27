// Bangit - Toast notification component

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {'info'|'success'|'warning'|'error'} type - Toast type
 */
export function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.bangit-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `bangit-toast bangit-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('bangit-toast-visible');
  });

  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('bangit-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
