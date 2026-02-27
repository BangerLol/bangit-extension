import React from 'react';
import { formatNumber } from '../utils/formatters.js';
import SectionHeader from './SectionHeader.jsx';

export default function PowerSection({ accountData, onInfoPress }) {
  const currentPower = accountData?.currentPower || 0;
  const maxPower = accountData?.maxPower || 0;

  const powerPercentage = maxPower > 0 ? Math.min((currentPower / maxPower) * 100, 100) : 0;

  return (
    <div className="power-section">
      <SectionHeader title="Power" emoji="⚡" onInfoPress={onInfoPress} />
      <div className="power-stats">
        <div className="power-stat">
          <span className="power-stat-label">Max:</span>
          <span className="power-stat-value" id="max-power">{formatNumber(maxPower)}</span>
        </div>
        <div className="power-stat">
          <span className="power-stat-label">Available:</span>
          <span className="power-stat-value" id="current-power">{formatNumber(currentPower)}</span>
        </div>
      </div>
      <div className="power-bar">
        <div className="power-bar-fill" id="power-bar-fill" style={{ width: `${powerPercentage}%` }}></div>
      </div>
    </div>
  );
}
