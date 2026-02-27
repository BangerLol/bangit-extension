import React from 'react';

export default function InfoModal({ visible, onClose, title, children }) {
  if (!visible) return null;

  return (
    <div className="info-modal-overlay" onClick={onClose}>
      <div className="info-modal" onClick={(e) => e.stopPropagation()}>
        <h4 className="info-modal-title">{title}</h4>
        <div className="info-modal-content">{children}</div>
        <button className="info-modal-close" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
