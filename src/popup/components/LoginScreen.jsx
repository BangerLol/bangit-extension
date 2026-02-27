export default function LoginScreen({ onLogin }) {
  return (
    <div id="logged-out" className="state-container">
      <div className="auth-prompt">
        <div className="login-branding">
          <img src="media/bangitLogoNew-rounded-192x192.png" width="64" height="64" alt="Bangit Logo" />
          <span className="login-brand-name">Bangit</span>
        </div>
        <h2>The Curator Economy</h2>
        <button id="login-btn" className="primary-btn" onClick={onLogin}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          Login with Twitter/X
        </button>
      </div>
    </div>
  );
}
