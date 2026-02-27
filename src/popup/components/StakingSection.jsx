import React, { useState } from 'react';
import { formatTokenAmount } from '../utils/formatters.js';
import { claimVested, openExternalUrl } from '../hooks/useChrome.js';
import SectionHeader from './SectionHeader.jsx';
import InfoModal from './InfoModal.jsx';

export default function StakingSection({ accountData, user, onRefresh, onInfoPress }) {
  const [claimVestedLoading, setClaimVestedLoading] = useState(false);
  const [showMultiplierInfo, setShowMultiplierInfo] = useState(false);
  const [showRewardBoostInfo, setShowRewardBoostInfo] = useState(false);

  const tokenBalance = (accountData?.tokenBalance || 0) / 1e9;
  const stakedTokens = (accountData?.stakedTokens || 0) / 1e9;
  const multiplier = accountData?.multiplier || 1;
  const rewardBoost = accountData?.rewardBoost || 1;
  const vestingTokens = (accountData?.vestingTokens || 0) / 1e9;
  const claimableVested = (accountData?.claimableVestedTokens || 0) / 1e9;

  const showStakingMultipliers = stakedTokens > 0;
  const showVesting = vestingTokens > 0 || claimableVested > 0;

  const handleStake = () => {
    if (user?.twitterUsername) {
      openExternalUrl(`https://bangit.xyz/${user.twitterUsername}/account`);
    }
  };

  const handleUnstake = () => {
    if (user?.twitterUsername) {
      openExternalUrl(`https://bangit.xyz/${user.twitterUsername}/account`);
    }
  };

  const handleClaimVested = async () => {
    setClaimVestedLoading(true);

    try {
      const response = await claimVested();
      if (response?.success) {
        setTimeout(() => {
          onRefresh();
          setClaimVestedLoading(false);
        }, 1500);
      } else {
        throw new Error(response?.error || 'Failed to claim vested tokens');
      }
    } catch (error) {
      console.error('Error claiming vested tokens:', error);
      setClaimVestedLoading(false);
    }
  };

  return (
    <div className="staking-section">
      <SectionHeader title="Staking" emoji="💎" onInfoPress={onInfoPress} />
      <div className="staking-stats">
        <div className="staking-stat">
          <span className="staking-label">Staked:</span>
          <span className="staking-value" id="staked-tokens">{formatTokenAmount(stakedTokens)} BANG</span>
        </div>
        <div className="staking-stat">
          <span className="staking-label">Unstaked:</span>
          <span className="staking-value" id="token-balance">{formatTokenAmount(tokenBalance)} BANG</span>
        </div>
        {showStakingMultipliers && (
          <>
            <div className="staking-stat" id="multiplier-row">
              <span className="staking-label">
                Time Multiplier:
                <button className="stat-info-button" onClick={() => setShowMultiplierInfo(true)} aria-label="Info about Time Multiplier">
                  <svg className="stat-info-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </button>
              </span>
              <span className="staking-value" id="multiplier">{multiplier.toFixed(2)}x</span>
            </div>
            <div className="staking-stat" id="reward-boost-row">
              <span className="staking-label">
                Reward Boost:
                <button className="stat-info-button" onClick={() => setShowRewardBoostInfo(true)} aria-label="Info about Reward Boost">
                  <svg className="stat-info-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </button>
              </span>
              <span className="staking-value" id="reward-boost">{rewardBoost.toFixed(2)}x</span>
            </div>
          </>
        )}
      </div>
      <div className="staking-buttons">
        <button id="unstake-btn" className="action-btn tertiary-btn" onClick={handleUnstake}>
          Unstake
        </button>
        <button id="stake-btn" className="action-btn primary-btn" onClick={handleStake}>
          Stake
        </button>
      </div>

      {/* Vesting Section */}
      {showVesting && (
        <div id="vesting-section" className="vesting-section">
          <div className="vesting-stats">
            <div className="vesting-stat">
              <span>Unstaking:</span>
              <span id="vesting-tokens">{formatTokenAmount(vestingTokens)} BANG</span>
            </div>
            <div className="vesting-stat">
              <span>Claimable:</span>
              <span id="claimable-vested">{formatTokenAmount(claimableVested)} BANG</span>
            </div>
          </div>
          <button
            id="claim-vested-btn"
            className={`action-btn primary-btn full-width ${claimVestedLoading ? 'loading' : ''}`}
            disabled={claimableVested <= 0 || claimVestedLoading}
            onClick={handleClaimVested}
          >
            {claimVestedLoading ? (
              <><div className="spinner-small"></div> Claiming...</>
            ) : (
              'Claim Unstaked'
            )}
          </button>
        </div>
      )}

      <InfoModal
        visible={showMultiplierInfo}
        onClose={() => setShowMultiplierInfo(false)}
        title="Time Multiplier"
      >
        <p>A daily increasing multiplier for Max Power.</p>
        <pre className="info-code">
{`Time Multiplier =
1 + (0.01 × Days Staked)`}
        </pre>
        <pre className="info-code">Max Time Multiplier = 5</pre>
        <p className="info-subheading">When staking additional BANG:</p>
        <pre className="info-code">
{`New Multiplier =
((Old Stake × Old Multiplier)
+ Additional Stake) / New Stake`}
        </pre>
        <p>Unstaking BANG does not affect Time Multiplier for remaining stake.</p>
      </InfoModal>

      <InfoModal
        visible={showRewardBoostInfo}
        onClose={() => setShowRewardBoostInfo(false)}
        title="Reward Boost"
      >
        <p>A boost for Creator and Inviter Rewards based on Max Power.</p>
        <pre className="info-code">
{`Reward Boost =
1 + ((Max Power - 100) / 1000)`}
        </pre>
        <pre className="info-code">Max Reward Boost = 3</pre>
      </InfoModal>
    </div>
  );
}
