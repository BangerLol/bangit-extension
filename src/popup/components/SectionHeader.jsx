import React from 'react';

export default function SectionHeader({ title, emoji, onInfoPress }) {
  return (
    <div className="section-header">
      <button className="info-button" onClick={onInfoPress} aria-label={`Info about ${title}`}>
        <svg className="info-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>
      <h3 className="section-title">{title}</h3>
      <span className="section-emoji">{emoji}</span>
    </div>
  );
}
