import {
  IconActivity,
  IconAdjustments,
  IconBook2,
  IconChevronRight,
  IconDashboard,
  IconKey,
  IconLogout,
  IconMenu2,
  IconShieldLock,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { BrandLockup } from '../components/BrandLockup';
import { useAdmin } from './AdminContext';

const navigation = [
  { to: '/admin', label: 'Overview', icon: IconDashboard, end: true },
  {
    to: '/admin/platform',
    label: 'Platform',
    icon: IconAdjustments,
    end: false,
  },
  { to: '/admin/users', label: 'Users', icon: IconUsers, end: false },
  {
    to: '/admin/entitlements',
    label: 'Entitlements',
    icon: IconKey,
    end: false,
  },
  {
    to: '/admin/audit',
    label: 'Audit activity',
    icon: IconActivity,
    end: false,
  },
  {
    to: '/admin/guides',
    label: 'Guides',
    icon: IconBook2,
    end: false,
  },
] as const;

export function AdminShell() {
  const { api, session } = useAdmin();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();

  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.logout();
      await navigate('/auth', { replace: true });
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="admin-layout">
      <a className="skip-link" href="#admin-content">
        Skip to content
      </a>
      <aside
        className={`admin-sidebar${navigationOpen ? ' admin-sidebar--open' : ''}`}
        aria-label="Admin navigation"
      >
        <div className="admin-sidebar__brand">
          <BrandLockup />
          <button
            aria-label="Close admin navigation"
            className="admin-sidebar__close"
            type="button"
            onClick={() => setNavigationOpen(false)}
          >
            <IconX aria-hidden="true" stroke={1.75} />
          </button>
        </div>

        <nav className="admin-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              className={({ isActive }) =>
                `admin-nav__link${isActive ? ' admin-nav__link--active' : ''}`
              }
              end={end}
              to={to}
              onClick={() => setNavigationOpen(false)}
            >
              <Icon aria-hidden="true" stroke={1.75} />
              <span>{label}</span>
              <IconChevronRight
                aria-hidden="true"
                className="admin-nav__chevron"
                stroke={1.75}
              />
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar__guard">
          <IconShieldLock aria-hidden="true" stroke={1.75} />
          <div>
            <strong>Admin only</strong>
            <span>Role verified by the platform API</span>
          </div>
        </div>
      </aside>

      {navigationOpen ? (
        <button
          aria-label="Close navigation overlay"
          className="admin-sidebar__scrim"
          type="button"
          onClick={() => setNavigationOpen(false)}
        />
      ) : null}

      <div className="admin-workspace">
        <header className="admin-topbar">
          <button
            aria-label="Open admin navigation"
            className="admin-topbar__menu"
            type="button"
            onClick={() => setNavigationOpen(true)}
          >
            <IconMenu2 aria-hidden="true" stroke={1.75} />
          </button>
          <div>
            <span className="admin-topbar__label">Admin console</span>
            <span className="admin-topbar__status">API verified</span>
          </div>
          <div className="admin-account">
            <span className="admin-account__avatar" aria-hidden="true">
              {(session.account.displayName ?? session.account.email)
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <span className="admin-account__identity">
              <strong>{session.account.displayName ?? 'Administrator'}</strong>
              <small>{session.account.email}</small>
            </span>
            <button
              aria-label={signingOut ? 'Signing out' : 'Sign out'}
              className="admin-account__logout"
              type="button"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <IconLogout aria-hidden="true" stroke={1.75} />
              <span>{signingOut ? 'Signing out' : 'Sign out'}</span>
            </button>
          </div>
        </header>
        <main id="admin-content" className="admin-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminShell;
