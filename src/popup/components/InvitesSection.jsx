import React, { useState, useCallback } from 'react';
import { formatTokenAmount } from '../utils/formatters.js';
import { getInviteDetails, openExternalUrl } from '../hooks/useChrome.js';
import SectionHeader from './SectionHeader.jsx';

export default function InvitesSection({ inviteCodes, user, onInfoPress }) {
  const [expandedInvites, setExpandedInvites] = useState({});
  const [inviteDetails, setInviteDetails] = useState({});
  const [loadingInvites, setLoadingInvites] = useState({});

  const hasInvites = inviteCodes && inviteCodes.length > 0;

  const handleToggleInvite = useCallback(async (inviteId) => {
    const isExpanded = expandedInvites[inviteId];

    if (!isExpanded) {
      setExpandedInvites(prev => ({ ...prev, [inviteId]: true }));

      // Load details if not already loaded
      if (!inviteDetails[inviteId] && !loadingInvites[inviteId]) {
        setLoadingInvites(prev => ({ ...prev, [inviteId]: true }));

        try {
          const response = await getInviteDetails(inviteId);
          if (response?.success && response.data) {
            setInviteDetails(prev => ({ ...prev, [inviteId]: response.data }));
          }
        } catch (error) {
          console.error('Error loading invite details:', error);
        } finally {
          setLoadingInvites(prev => ({ ...prev, [inviteId]: false }));
        }
      }
    } else {
      setExpandedInvites(prev => ({ ...prev, [inviteId]: false }));
    }
  }, [expandedInvites, inviteDetails, loadingInvites]);

  const handleEditInvite = useCallback(() => {
    if (user?.twitterUsername) {
      openExternalUrl(`https://bangit.xyz/${user.twitterUsername}/account`);
    }
  }, [user]);

  return (
    <div className="invites-section">
      <SectionHeader title="Invites" emoji="🔑" onInfoPress={onInfoPress} />

      {!hasInvites ? (
        <div id="no-invites" className="no-invites">
          <p>No invite codes available</p>
        </div>
      ) : (
        <div id="invite-cards">
          {inviteCodes.map((invite) => (
            <div className="invite-card" key={invite.id} data-invite-id={invite.id}>
              <div
                className={`invite-header ${expandedInvites[invite.id] ? 'expanded' : ''}`}
                onClick={() => handleToggleInvite(invite.id)}
                role="button"
                tabIndex={0}
              >
                <span className="invite-code">{invite.code}</span>
                <span className="invite-uses">
                  {invite.remainingUses} use{invite.remainingUses !== 1 ? 's' : ''}
                </span>
                <button
                  className="invite-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditInvite();
                  }}
                >
                  Edit
                </button>
                <div className={`invite-expand-btn ${expandedInvites[invite.id] ? 'expanded' : ''}`}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                  </svg>
                </div>
              </div>

              {expandedInvites[invite.id] && (
                <div className="invite-details" id={`invite-details-${invite.id}`}>
                  {loadingInvites[invite.id] ? (
                    <div className="invite-loading">
                      <div className="spinner-small"></div>
                      <span>Loading...</span>
                    </div>
                  ) : !inviteDetails[invite.id]?.users?.length ? (
                    <p className="invite-no-users">No users have used this code yet</p>
                  ) : (
                    <>
                      <div className="invite-users-header">
                        <span>User/Date</span>
                        <span>Curator Rewards</span>
                      </div>
                      {inviteDetails[invite.id].users.map((invitedUser, i) => (
                        <div className="invite-user" key={i}>
                          <div className="invite-user-info">
                            <div className="invite-user-name">
                              @{(invitedUser.username || 'Unknown').length > 10
                                ? (invitedUser.username || 'Unknown').slice(0, 10) + '...'
                                : (invitedUser.username || 'Unknown')}
                            </div>
                            <div className="invite-user-date">
                              {invitedUser.usedAt ? new Date(invitedUser.usedAt).toLocaleDateString() : 'Unknown'}
                            </div>
                          </div>
                          <div className="invite-user-rewards">
                            {formatTokenAmount((invitedUser.totalCuratorRewards || 0) / 1e9)} BANG
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
