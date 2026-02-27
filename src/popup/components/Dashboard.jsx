import React, { useState, useEffect, useCallback } from 'react';
import { getAccountData } from '../hooks/useChrome.js';
import UserInfo from './UserInfo.jsx';
import PowerSection from './PowerSection.jsx';
import RewardsSection from './RewardsSection.jsx';
import StakingSection from './StakingSection.jsx';
import InvitesSection from './InvitesSection.jsx';
import InfoModal from './InfoModal.jsx';

const INFO_CONTENT = {
  power: {
    title: 'Power',
    content: (
      <>
        <p>Voting requires power.<br/>Power regenerates at a rate of 100% per day.</p>
        <p>Stake BANG to increase Max Power for more rewards, clout, and influence on the feeds.</p>
        <div className="info-formula">
          <code>Max Power = 100<br/>+ (Staked BANG × Time Multiplier)</code>
        </div>
        <div className="info-tiers">
          <p><strong>Max Power tiers</strong></p>
          <div className="tier-list">
            <div className="tier-list-inner">
              <div className="tier-item"><span className="tier-badge tier-diamond">Diamond</span><span>: Top 1%</span></div>
              <div className="tier-item"><span className="tier-badge tier-emerald">Emerald</span><span>: Top 5%</span></div>
              <div className="tier-item"><span className="tier-badge tier-gold">Gold</span><span>: Top 20%</span></div>
              <div className="tier-item"><span className="tier-badge tier-silver">Silver</span><span>: Top 50%</span></div>
              <div className="tier-item"><span className="tier-badge tier-bronze">Bronze</span><span>: Top 100%</span></div>
            </div>
          </div>
        </div>
      </>
    ),
  },
  rewards: {
    title: 'Rewards',
    content: (
      <>
        <p>New BANG is allocated every 24 hours at midnight UTC, based on activity in the last 24 hours.</p>
        <div className="reward-types">
          <div className="reward-type">
            <span className="reward-label">Curator Rewards (80%)</span>
            <p className="modal-content">For voting on tweets before others.</p>
          </div>
          <div className="reward-type">
            <span className="reward-label">Creator Rewards (10%)</span>
            <p className="modal-content">For getting upvotes<br/>on authored tweets.</p>
          </div>
          <div className="reward-type">
            <span className="reward-label">Inviter Rewards (10%)</span>
            <p className="modal-content">For inviting good curators.</p>
          </div>
        </div>
        <p className="modal-content">10% of unclaimed rewards are burned every 24 hours they are left unclaimed.</p>
      </>
    ),
  },
  staking: {
    title: 'Staking',
    content: (
      <>
        <p>Stake BANG to increase Max Power for more rewards, clout, and influence on the feeds.</p>
        <div className="info-formula">
          <code>Time Multiplier (Max 5) =<br/>1 + (0.01 × Days Staked)</code>
          <code>Max Power =<br/>100 + (Staked BANG × Time Multiplier)</code>
          <code>Reward Boost (Max 3) =<br/>1 + ((Max Power - 100) / 1000)</code>
        </div>
        <p>Unstaking BANG has a 1-10% burn fee that decreases as Time Multiplier increases. Unstaking BANG decreases Max Power and Reward Boost immediately, while the BANG is gradually released over 7 days.</p>
      </>
    ),
  },
  invites: {
    title: 'Invites',
    content: (
      <>
        <p>Share your invite code with friends to earn invite rewards when they earn curator rewards.</p>
        <p>10% of BANG rewards go to inviters.</p>
        <p>For each upvoter who earned curator rewards in the period, inviter contributions:</p>
        <div className="invite-tiers">
          <span>Direct Inviter: <code>Curator Rewards × 5</code></span>
          <span>Level 2 Inviter: <code>Curator Rewards × 2</code></span>
          <span>Level 3 Inviter: <code>Curator Rewards × 1</code></span>
        </div>
        <div className="info-formula">
          <code>Boosted Contribution =<br/>SUM(Contributions) × Reward Boost</code>
          <code>Invite Reward =<br/>Boosted Contribution / Total Boosted Contribution × Total Invite Rewards</code>
        </div>
      </>
    ),
  },
};

export default function Dashboard({ user, onLogout }) {
  const [accountData, setAccountData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeInfoModal, setActiveInfoModal] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const accountResponse = await getAccountData();

      if (accountResponse?.success && accountResponse.data) {
        setAccountData(accountResponse.data);
      }
    } catch (error) {
      console.error('[Bangit] Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDataRefresh = useCallback(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="state-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner"></div>
        <p style={{ fontSize: '16px', marginTop: '16px' }}>Loading account</p>
      </div>
    );
  }

  return (
    <div id="logged-in" className="state-container">
      <UserInfo user={user} />
      <PowerSection
        accountData={accountData}
        onInfoPress={() => setActiveInfoModal('power')}
      />
      <RewardsSection
        accountData={accountData}
        onRefresh={handleDataRefresh}
        onInfoPress={() => setActiveInfoModal('rewards')}
      />
      <StakingSection
        accountData={accountData}
        user={user}
        onRefresh={handleDataRefresh}
        onInfoPress={() => setActiveInfoModal('staking')}
      />
      <InvitesSection
        inviteCodes={accountData?.inviteCodes}
        user={user}
        onInfoPress={() => setActiveInfoModal('invites')}
      />
      <button id="logout-btn" className="logout-btn" onClick={onLogout}>
        Logout
      </button>
      {activeInfoModal && (
        <InfoModal
          visible={true}
          onClose={() => setActiveInfoModal(null)}
          title={INFO_CONTENT[activeInfoModal].title}
        >
          {INFO_CONTENT[activeInfoModal].content}
        </InfoModal>
      )}
    </div>
  );
}
