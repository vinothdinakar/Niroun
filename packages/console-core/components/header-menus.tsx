'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A small dropdown anchored under an icon button. Closes on an outside click or Escape. */
function IconMenu({ icon, label, panel }: { icon: ReactNode; label: string; panel: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="icon-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
      </button>
      {open && <div className="icon-menu-panel" role="menu" onClick={() => setOpen(false)}>{panel}</div>}
    </div>
  );
}

export function NotificationsMenu() {
  return (
    <IconMenu
      label="Notifications"
      icon={<BellIcon />}
      panel={<p className="muted small icon-menu-empty">No notifications yet.</p>}
    />
  );
}

export function ProfileMenu({ name, role, orgName, onSignOut }: { name: string; role: string; orgName: string | null; onSignOut: () => void }) {
  return (
    <IconMenu
      label="Account menu"
      icon={<ProfileIcon />}
      panel={
        <>
          <div className="icon-menu-header">
            <b>{name}</b>
            <span className="muted small">{role}{orgName ? ` · ${orgName}` : ''}</span>
          </div>
          <div className="icon-menu-divider" />
          <Link href="/account" className="icon-menu-item" role="menuitem">Account settings</Link>
          <div className="icon-menu-divider" />
          <button type="button" className="icon-menu-item" onClick={onSignOut}>Sign out</button>
        </>
      }
    />
  );
}

function BellIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}
