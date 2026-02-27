import React from 'react';

export default function LoadingState() {
  return (
    <div id="loading" className="state-container">
      <div className="spinner"></div>
      <p>Loading...</p>
    </div>
  );
}
