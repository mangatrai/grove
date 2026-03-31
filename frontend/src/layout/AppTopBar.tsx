import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiJson, setToken, useAuthToken } from "../api";
import { startImportSession } from "../import/startImportSession";

type AppTopBarProps = {
  onOpenMobileNav: () => void;
};

const AVATAR_KEY_EMOJI: Record<string, string> = {
  person: "👤",
  home: "🏠",
  wallet: "💳",
  briefcase: "💼",
  star: "⭐"
};

type ProfileResponse = {
  profile: {
    fullName: string;
    avatarKey: string | null;
  };
};

export function AppTopBar({ onOpenMobileNav }: AppTopBarProps) {
  const token = useAuthToken();
  const navigate = useNavigate();
  const [importBusy, setImportBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLabel, setMenuLabel] = useState("Account");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!token) {
      setMenuLabel("Account");
      return;
    }
    let cancelled = false;
    void apiJson<ProfileResponse>("/household/profile")
      .then((r) => {
        if (cancelled) {
          return;
        }
        const firstName = r.profile.fullName.trim().split(/\s+/)[0] ?? "Account";
        const emoji = AVATAR_KEY_EMOJI[r.profile.avatarKey ?? ""] ?? "👤";
        setMenuLabel(`${emoji} ${firstName}`);
      })
      .catch(() => {
        if (!cancelled) {
          setMenuLabel("Account");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    setMenuOpen(false);
    navigate("/", { replace: true });
  }

  return (
    <header className="app-topbar">
      <div className="app-topbar__inner">
        <button
          type="button"
          className="app-topbar__menu-btn"
          aria-label="Open navigation menu"
          onClick={onOpenMobileNav}
        >
          <span className="nav-burger-lines" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="app-topbar__spacer" aria-hidden />
        <div className="app-topbar__actions">
          <button type="button" disabled={importBusy} onClick={() => void onNewImport()}>
            {importBusy ? "Starting…" : "New import"}
          </button>
          <div className="user-menu" ref={menuRef}>
            <button
              type="button"
              className="user-menu__trigger secondary"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              {menuLabel}
            </button>
            {menuOpen ? (
              <div className="user-menu__dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
                <Link to="/settings" className="user-menu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Settings
                </Link>
                <button type="button" className="user-menu__item user-menu__item--button" role="menuitem" onClick={logout}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
