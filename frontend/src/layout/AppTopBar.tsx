import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionIcon, AppShell, useMantineColorScheme } from "@mantine/core";
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconUpload,
  IconMenu2,
} from "@tabler/icons-react";

import { apiJson, setToken, useAuthToken } from "../api";
import { NotificationPanel } from "../components/NotificationPanel";

type AppTopBarProps = {
  onOpenMobileNav: () => void;
};

const AVATAR_KEY_EMOJI: Record<string, string> = {
  person: "👤",
  home: "🏠",
  wallet: "💳",
  briefcase: "💼",
  star: "⭐",
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
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLabel, setMenuLabel] = useState("Account");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
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
    function loadLabel() {
      void apiJson<ProfileResponse>("/household/profile")
        .then((r) => {
          if (cancelled) return;
          const firstName =
            r.profile.fullName.trim().split(/\s+/)[0] ?? "Account";
          const emoji = AVATAR_KEY_EMOJI[r.profile.avatarKey ?? ""] ?? "👤";
          setMenuLabel(`${emoji} ${firstName}`);
        })
        .catch(() => {
          if (!cancelled) setMenuLabel("Account");
        });
    }
    loadLabel();
    function onProfileUpdated() {
      loadLabel();
    }
    window.addEventListener("app:household-profile-updated", onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "app:household-profile-updated",
        onProfileUpdated
      );
    };
  }, [token]);

  function onNewImport() {
    navigate("/imports/workspace");
  }

  function logout() {
    // Fire-and-forget: tell the server to invalidate the token (increments token_version).
    // We clear the local token and redirect regardless of the server response so the
    // user is never stuck on a logout failure.
    void fetch("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("hf_jwt") ?? ""}` }
    }).catch(() => {});
    setToken(null);
    setMenuOpen(false);
    navigate("/", { replace: true });
  }

  return (
    <AppShell.Header
      style={{
        background: "var(--color-sidebar-bg)",
        borderBottom: "1px solid var(--color-sidebar-border)",
        boxShadow: "0 1px 0 rgba(0, 0, 0, 0.12)",
      }}
    >
      <div className="app-topbar__inner">
        {/* Mobile hamburger */}
        <ActionIcon
          hiddenFrom="sm"
          variant="subtle"
          size="lg"
          aria-label="Open navigation menu"
          onClick={onOpenMobileNav}
        >
          <IconMenu2 size={20} color="#94a3b8" />
        </ActionIcon>

        <div className="app-topbar__spacer" aria-hidden />

        <div className="app-topbar__actions">
          {/* Theme switcher: Light | Auto (OS) | Dark */}
          <div className="theme-switcher" role="group" aria-label="Color scheme">
            <button
              type="button"
              className={`theme-switcher__btn${colorScheme === "light" ? " theme-switcher__btn--active" : ""}`}
              onClick={() => setColorScheme("light")}
              title="Light mode"
              aria-label="Light mode"
              aria-pressed={colorScheme === "light"}
            >
              <IconSun size={13} />
            </button>
            <button
              type="button"
              className={`theme-switcher__btn${colorScheme === "auto" ? " theme-switcher__btn--active" : ""}`}
              onClick={() => setColorScheme("auto")}
              title="Auto — follow OS setting"
              aria-label="Auto (follow OS)"
              aria-pressed={colorScheme === "auto"}
            >
              <IconDeviceDesktop size={13} />
            </button>
            <button
              type="button"
              className={`theme-switcher__btn${colorScheme === "dark" ? " theme-switcher__btn--active" : ""}`}
              onClick={() => setColorScheme("dark")}
              title="Dark mode"
              aria-label="Dark mode"
              aria-pressed={colorScheme === "dark"}
            >
              <IconMoon size={13} />
            </button>
          </div>

          {/* Import button */}
          <button
            type="button"
            className="app-topbar__import-btn"
            onClick={onNewImport}
            aria-label="New import"
          >
            <IconUpload size={15} />
            <span>Import</span>
          </button>

          {/* Notifications */}
          <NotificationPanel />

          {/* User menu */}
          <div className="user-menu" ref={menuRef}>
            <button
              type="button"
              className="user-menu__trigger"
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
              <div
                className="user-menu__dropdown"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  to="/settings"
                  className="user-menu__item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="user-menu__item user-menu__item--button"
                  role="menuitem"
                  onClick={logout}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell.Header>
  );
}
