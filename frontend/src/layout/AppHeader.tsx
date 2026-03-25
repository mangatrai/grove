import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { setToken } from "../api";
import { startImportSession } from "../import/startImportSession";

function navClass(active: boolean): string {
  return active ? "nav-link nav-link--active" : "nav-link";
}

export function AppHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function onNewImport() {
    setImportBusy(true);
    try {
      const id = await startImportSession();
      navigate(`/imports/${id}`);
    } finally {
      setImportBusy(false);
    }
  }

  function logout() {
    setToken(null);
    navigate("/", { replace: true });
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/" className="app-brand">
          Household Finance
        </Link>
        <button
          type="button"
          className="nav-burger"
          aria-expanded={menuOpen}
          aria-controls="app-main-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="nav-burger-lines" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>

        <div
          className={`app-header-panel ${menuOpen ? "app-header-panel--open" : ""}`}
          id="app-main-nav"
        >
          <nav className="app-nav" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
              Home
            </NavLink>
            <NavLink to="/transactions" className={({ isActive }) => navClass(isActive)}>
              Ledger
            </NavLink>
            <NavLink to="/categories" className={({ isActive }) => navClass(isActive)}>
              Categories
            </NavLink>
            <NavLink to="/resolution" className={({ isActive }) => navClass(isActive)}>
              Review queue
            </NavLink>
          </nav>
          <div className="app-header-actions">
            <button type="button" disabled={importBusy} onClick={() => void onNewImport()}>
              {importBusy ? "Starting…" : "New import"}
            </button>
            <button type="button" className="secondary" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
