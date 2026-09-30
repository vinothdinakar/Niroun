'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A small dropdown anchored under an icon button. Closes on an outside click or Escape. */
function IconMenu({ icon, label, panel, panelClass = '' }: { icon: ReactNode; label: string; panel: ReactNode; panelClass?: string }) {
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
      {open && <div className={`icon-menu-panel ${panelClass}`.trim()} role="menu" onClick={() => setOpen(false)}>{panel}</div>}
    </div>
  );
}

// Where each tile leads. Read at build time (Next inlines NEXT_PUBLIC_* values), so they are set in the environment the
// app is built with. A tile with no value stays visible but disabled.
const LINKS = {
  support: process.env.NEXT_PUBLIC_SUPPORT_URL,
  docs: process.env.NEXT_PUBLIC_DOCS_URL,
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE,
  mitm: process.env.NEXT_PUBLIC_MITM_URL,
};

interface Tile { label: string; href: string | undefined; external: boolean; icon: ReactNode }

/** The little grid of shortcuts in the top right: help and contact. */
export function AppsMenu({ links = LINKS }: { links?: typeof LINKS }) {
  const tiles: Tile[] = [
    { label: 'Support', href: links.support, external: true, icon: <SupportIcon /> },
    { label: 'Docs', href: links.docs, external: true, icon: <DocsIcon /> },
    { label: 'Email', href: links.email ? `mailto:${links.email}` : undefined, external: false, icon: <MailIcon /> },
    { label: 'Phone', href: links.phone ? `tel:${links.phone.replace(/[^\d+]/g, '')}` : undefined, external: false, icon: <PhoneIcon /> },
    { label: 'Man in Middle', href: links.mitm, external: true, icon: <MitmIcon /> },
  ];
  return (
    <IconMenu
      label="Help and contact"
      icon={<GridIcon />}
      panelClass="apps-panel"
      panel={
        <>
          {tiles.map((t) => t.href ? (
            <a key={t.label} className="app-tile" role="menuitem" href={t.href} {...(t.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {t.icon}<span>{t.label}</span>
            </a>
          ) : (
            <span key={t.label} className="app-tile disabled" role="menuitem" aria-disabled="true" title="Not set up yet">
              {t.icon}<span>{t.label}</span>
            </span>
          ))}
        </>
      }
    />
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

const tileIcon = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function GridIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[4, 10, 16].flatMap((x) => [4, 10, 16].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="1" />))}
    </svg>
  );
}
function SupportIcon() {
  return (<svg {...tileIcon}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></svg>);
}
function DocsIcon() {
  return (<svg {...tileIcon}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9.5 12h5M9.5 15.5h5" /></svg>);
}
function MailIcon() {
  return (<svg {...tileIcon}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>);
}
function PhoneIcon() {
  return (<svg {...tileIcon}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>);
}
function MitmIcon() {
  return (<svg {...tileIcon}><circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><path d="M7.2 12h2.6M14.2 12h2.6" /></svg>);
}
