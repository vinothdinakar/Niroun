import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { routeMeta } from '../routes';

const LINKS = [
  ['/how-it-works', 'How it works'],
  ['/pricing', 'Pricing'],
  ['/security', 'Security'],
  ['/developers', 'Developers'],
] as const;

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#121a30" stroke="#22305a" />
        <path d="M9 8h8.5a4.5 4.5 0 0 1 1.9 8.6A4.7 4.7 0 0 1 17.8 25H9z" fill="none" stroke="#3ddbc0" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M9 16.5h8.6" stroke="#3ddbc0" strokeWidth="2.4" />
      </svg>
      <span>Bond</span>
    </span>
  );
}

export function Layout() {
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    document.title = routeMeta(pathname).title;
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" aria-label="Bond home"><Logo /></Link>
          <button
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((o) => !o)}
          >
            Menu
          </button>
          <nav id="site-nav" className={open ? 'nav-links open' : 'nav-links'} aria-label="Main">
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {label}
              </NavLink>
            ))}
            <Link to="/waitlist" className="btn btn-primary btn-sm">Join the waitlist</Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <Logo />
            <p className="muted small">Trust, bonding and dispute resolution for AI agents.</p>
            <p className="muted small">
              Private preview. The prototype runs on simulated funds; no real money moves.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/security">Security</Link>
          </div>
          <div>
            <h4>Build</h4>
            <Link to="/developers">Developers</Link>
            <Link to="/waitlist">Join the waitlist</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
