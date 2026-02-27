import React, { useState } from 'react';
import { formatTokenAmount } from '../utils/formatters.js';
import { claimRewards, claimAndStake } from '../hooks/useChrome.js';
import SectionHeader from './SectionHeader.jsx';

export default function RewardsSection({ accountData, onRefresh, onInfoPress }) {
  const [totalExpanded, setTotalExpanded] = useState(false);
  const [claimableExpanded, setClaimableExpanded] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimStakeLoading, setClaimStakeLoading] = useState(false);
  const [claimConfirmPending, setClaimConfirmPending] = useState(false);
  const [noRewardsError, setNoRewardsError] = useState(false);

  const totalRewards = (accountData?.totalRewards || 0) / 1e9;
  const totalCuratorRewards = (accountData?.totalCuratorRewards || 0) / 1e9;
  const totalCreatorRewards = (accountData?.totalCreatorRewards || 0) / 1e9;
  const totalInviterRewards = (accountData?.totalInviterRewards || 0) / 1e9;

  const claimableCurator = accountData?.claimableCuratorRewards || 0;
  const claimableCreator = accountData?.claimableCreatorRewards || 0;
  const claimableInviter = accountData?.claimableInviterRewards || 0;
  const totalClaimable = (claimableCurator + claimableCreator + claimableInviter) / 1e9;

  const hasClaimable = totalClaimable > 0;

  const handleClaim = async () => {
    if (!hasClaimable) {
      setNoRewardsError(true);
      setTimeout(() => setNoRewardsError(false), 3000);
      return;
    }

    if (!claimConfirmPending) {
      setClaimConfirmPending(true);
      setTimeout(() => setClaimConfirmPending(false), 3000);
      return;
    }

    setClaimConfirmPending(false);
    setClaimLoading(true);

    try {
      const response = await claimRewards();
      if (response?.success) {
        setTimeout(() => {
          onRefresh();
          setClaimLoading(false);
        }, 1500);
      } else {
        throw new Error(response?.error || 'Failed to claim');
      }
    } catch (error) {
      console.error('Error claiming rewards:', error);
      setClaimLoading(false);
    }
  };

  const handleClaimAndStake = async () => {
    if (!hasClaimable) {
      setNoRewardsError(true);
      setTimeout(() => setNoRewardsError(false), 3000);
      return;
    }

    setClaimStakeLoading(true);

    try {
      const response = await claimAndStake();
      if (response?.success) {
        setTimeout(() => {
          onRefresh();
          setClaimStakeLoading(false);
        }, 1500);
      } else {
        throw new Error(response?.error || 'Failed to claim and stake');
      }
    } catch (error) {
      console.error('Error claiming and staking:', error);
      setClaimStakeLoading(false);
    }
  };

  return (
    <div className="rewards-section">
      <SectionHeader title="Rewards" emoji="🎁" onInfoPress={onInfoPress} />

      {/* Total Rewards Dropdown */}
      <div className="dropdown-container">
        <button
          id="total-rewards-toggle"
          className={`dropdown-toggle ${totalExpanded ? 'expanded' : ''}`}
          onClick={() => setTotalExpanded(!totalExpanded)}
        >
          <span>Total: <span id="total-rewards-value">{formatTokenAmount(totalRewards)}</span> BANG</span>
          <svg className="chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </button>
        {totalExpanded && (
          <div id="total-rewards-content" className="dropdown-content">
            <div className="rewards-breakdown">
              <div className="rewards-row">
                <span>Curator:</span>
                <span id="total-curator-rewards">{formatTokenAmount(totalCuratorRewards)} BANG</span>
              </div>
              <div className="rewards-row">
                <span>Creator:</span>
                <span id="total-creator-rewards">{formatTokenAmount(totalCreatorRewards)} BANG</span>
              </div>
              <div className="rewards-row">
                <span>Inviter:</span>
                <span id="total-inviter-rewards">{formatTokenAmount(totalInviterRewards)} BANG</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Claimable Rewards Dropdown */}
      <div className="dropdown-container">
        <button
          id="claimable-rewards-toggle"
          className={`dropdown-toggle ${claimableExpanded ? 'expanded' : ''}`}
          onClick={() => setClaimableExpanded(!claimableExpanded)}
        >
          <span>Claimable: <span id="claimable-rewards-value">{formatTokenAmount(totalClaimable)}</span> BANG</span>
          <svg className="chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </button>
        {claimableExpanded && (
          <div id="claimable-rewards-content" className="dropdown-content">
            <div className="rewards-breakdown">
              <div className="rewards-row">
                <span>Curator:</span>
                <span id="claimable-curator-rewards">{formatTokenAmount(claimableCurator / 1e9)} BANG</span>
              </div>
              <div className="rewards-row">
                <span>Creator:</span>
                <span id="claimable-creator-rewards">{formatTokenAmount(claimableCreator / 1e9)} BANG</span>
              </div>
              <div className="rewards-row">
                <span>Inviter:</span>
                <span id="claimable-inviter-rewards">{formatTokenAmount(claimableInviter / 1e9)} BANG</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Claim Buttons */}
      <div className="rewards-buttons">
        <button
          id="claim-btn"
          className={`action-btn tertiary-btn ${claimLoading ? 'loading' : ''} ${claimConfirmPending ? 'confirm-fee' : ''}`}
          disabled={claimLoading}
          onClick={handleClaim}
        >
          {claimLoading ? (
            <><div className="spinner-small"></div> Claiming...</>
          ) : claimConfirmPending ? (
            '10% fee'
          ) : (
            'Claim'
          )}
        </button>
        <button
          id="claim-stake-btn"
          className={`action-btn primary-btn ${claimStakeLoading ? 'loading' : ''}`}
          disabled={claimStakeLoading}
          onClick={handleClaimAndStake}
        >
          {claimStakeLoading ? (
            <><div className="spinner-small"></div> Claiming...</>
          ) : (
            'Claim + Stake'
          )}
        </button>
      </div>
      {noRewardsError && (
        <div className="no-rewards-error" style={{ color: '#ff7f7f', textAlign: 'center', marginTop: '8px', fontSize: '13px' }}>
          No rewards to claim
        </div>
      )}
    </div>
  );
}
