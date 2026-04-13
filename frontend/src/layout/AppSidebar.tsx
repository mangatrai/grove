import { Link, NavLink } from "react-router-dom";
import {
  IconHome,
  IconChartBar,
  IconScale,
  IconReceipt,
  IconFileText,
  IconTag,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

type NavItem = {
  to: string;
  end: boolean;
  label: string;
  Icon: TablerIcon;
};

const NAV: NavItem[] = [
  { to: "/", end: true, label: "Home", Icon: IconHome },
  { to: "/budget", end: false, label: "Budget", Icon: IconChartBar },
  { to: "/net-worth", end: false, label: "Net worth", Icon: IconScale },
  { to: "/transactions", end: false, label: "Transactions", Icon: IconReceipt },
  { to: "/payslips", end: false, label: "Payslips", Icon: IconFileText },
  { to: "/categories", end: false, label: "Categories", Icon: IconTag },
];

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

function navClass(active: boolean): string {
  return active
    ? "app-sidebar__link app-sidebar__link--active"
    : "app-sidebar__link";
}

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const isCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close menu"
          onClick={onCloseMobile}
        />
      ) : null}
      <aside
        className={[
          "app-sidebar",
          isCollapsed ? "app-sidebar--collapsed" : "",
          mobileOpen ? "app-sidebar--mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="app-sidebar__top">
          <Link
            to="/"
            className="app-sidebar__brand"
            onClick={onCloseMobile}
            title="Household Finance"
          >
            <span className="app-sidebar__brand-abbr" aria-hidden>
              HF
            </span>
            <span className="app-sidebar__brand-text">Household Finance</span>
          </Link>
        </div>

        {/* Main nav */}
        <nav className="app-sidebar__nav" aria-label="Main">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={isCollapsed ? label : undefined}
              className={({ isActive }) => navClass(isActive)}
              onClick={onCloseMobile}
            >
              <span className="app-sidebar__link-icon" aria-hidden>
                <Icon size={18} stroke={1.75} />
              </span>
              <span className="app-sidebar__link-text">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom: Settings + collapse toggle */}
        <div className="app-sidebar__footer">
          <NavLink
            to="/settings"
            title={isCollapsed ? "Settings" : undefined}
            className={({ isActive }) => navClass(isActive)}
            onClick={onCloseMobile}
          >
            <span className="app-sidebar__link-icon" aria-hidden>
              <IconSettings size={18} stroke={1.75} />
            </span>
            <span className="app-sidebar__link-text">Settings</span>
          </NavLink>

          <button
            type="button"
            className="app-sidebar__collapse-btn"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden>
              {isCollapsed ? (
                <IconChevronRight size={14} />
              ) : (
                <IconChevronLeft size={14} />
              )}
            </span>
            <span className="app-sidebar__collapse-text">
              {collapsed ? "Expand" : "Collapse"}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
