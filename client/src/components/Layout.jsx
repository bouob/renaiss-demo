import { NavLink } from 'react-router-dom';

export default function Layout({ children, user, onSignIn, onSignOut, authReady, firebaseOk }) {
  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="brand">
          <span>Merchant Copilot</span>
          <span className="brand-sub">Dokipoki · Renaiss</span>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Dashboard
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Inventory
          </NavLink>
          {authReady && firebaseOk && (
            user ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
                {user.displayName || user.email || 'Sign out'}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={onSignIn}>
                Sign in
              </button>
            )
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
