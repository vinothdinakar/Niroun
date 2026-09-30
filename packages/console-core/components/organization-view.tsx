'use client';

import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { OrgProfileView } from './org-profile-view';
import { TeamView } from './team-view';
import { VerificationView } from './verification-view';
import { WalletView } from './wallet-view';

const SECTIONS = [
  { id: 'profile', label: 'Profile', needs: null },
  { id: 'verification', label: 'Verification', needs: 'request_verification' },
  { id: 'team', label: 'Team', needs: 'team_manage' },
  { id: 'wallet', label: 'Wallet', needs: null },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// Everything about the customer's own organization in one place: who it is, whether it is verified, who works in it.
// A section shows only to people who can use it; the address (#verification, #team, #wallet) opens straight to one.
export function OrganizationView() {
  const { has } = useSession();
  const [active, setActive] = useState<SectionId>('profile');
  const shown = SECTIONS.filter((s) => !s.needs || has(s.needs));

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (shown.some((s) => s.id === id)) setActive(id as SectionId);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length]);

  const pick = (id: SectionId) => {
    setActive(id);
    window.history.replaceState(null, '', id === 'profile' ? window.location.pathname : `#${id}`);
  };
  const current = shown.some((s) => s.id === active) ? active : 'profile';

  return (
    <div className="tab">
      <div className="tabs sub-tabs" role="tablist" aria-label="Organization sections">
        {shown.map((s) => (
          <button
            key={s.id} type="button" role="tab" id={`org-tab-${s.id}`} aria-selected={current === s.id}
            aria-controls="org-section" onClick={() => pick(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div id="org-section" role="tabpanel" aria-labelledby={`org-tab-${current}`}>
        {current === 'profile' && <OrgProfileView />}
        {current === 'verification' && <VerificationView />}
        {current === 'team' && <TeamView />}
        {current === 'wallet' && <WalletView />}
      </div>
    </div>
  );
}
