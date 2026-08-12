import { Link, NavLink } from "react-router-dom";
import { AppShell } from "@mantine/core";
import { GroveMark } from "../components/GroveMark";
import { useCurrentUser } from "../UserContext";
import {
  IconHome,
  IconChartBar,
  IconBuildingEstate,
  IconScale,
  IconGavel,
  IconReceipt,
  IconFileText,
  IconTrendingUp,
  IconTag,
  IconSettings,
  IconRun,
  IconBell,
  IconRobot,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardList,
  IconUsers,
  IconClock,
  IconWallet,
  IconCash,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

type NavItem = {
  to: string;
  end: boolean;
  label: string;
  Icon: TablerIcon;
};

/** Staff logins get a single-item minimal nav — no access to household finance screens. */
const STAFF_NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Portal",
    items: [{ to: "/staff", end: true, label: "My Portal", Icon: IconClipboardList }],
  },
];

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Daily",
    items: [
      { to: "/", end: true, label: "Home", Icon: IconHome },
      { to: "/transactions", end: false, label: "Transactions", Icon: IconReceipt },
      { to: "/payslips", end: false, label: "Payslips", Icon: IconFileText },
      { to: "/espp", end: false, label: "ESPP", Icon: IconTrendingUp },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/net-worth", end: false, label: "Net worth", Icon: IconScale },
      { to: "/budget", end: false, label: "Budget", Icon: IconChartBar },
    ],
  },
  {
    label: "Property & Tax",
    items: [
      { to: "/real-estate", end: false, label: "Real Estate", Icon: IconBuildingEstate },
      { to: "/tax-protest", end: false, label: "Tax Protest", Icon: IconGavel },
    ],
  },
  {
    label: "Family",
    items: [
      { to: "/family/events", end: false, label: "Events", Icon: IconRun },
      { to: "/family/deadlines", end: false, label: "Deadlines", Icon: IconBell },
      { to: "/family/agent", end: false, label: "Agent", Icon: IconRobot },
    ],
  },
];

const SETUP_NAV_GROUP: { label: string; items: NavItem[] } = {
  label: "Setup",
  items: [
    { to: "/categories", end: false, label: "Categories", Icon: IconTag },
    { to: "/settings", end: false, label: "Settings", Icon: IconSettings },
  ],
};

/** Owner/admin-only group for managing household staff — inserted before Setup for those roles. */
const STAFF_ADMIN_NAV_GROUP: { label: string; items: NavItem[] } = {
  label: "Staff",
  items: [
    { to: "/staff-admin/directory", end: false, label: "Roster", Icon: IconUsers },
    { to: "/staff-admin/timesheets", end: false, label: "Timesheets", Icon: IconClock },
    { to: "/staff-admin/expenses", end: false, label: "Expenses", Icon: IconWallet },
    { to: "/staff-admin/pay", end: false, label: "Pay & Reports", Icon: IconCash },
  ],
};

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
  const { role } = useCurrentUser();
  const isCollapsed = collapsed && !mobileOpen;
  const visibleGroups = role === "staff"
    ? STAFF_NAV_GROUPS
    : role === "member"
      ? [...NAV_GROUPS.filter(g => g.label !== "Property & Tax" && g.label !== "Family"), SETUP_NAV_GROUP]
      : [...NAV_GROUPS, STAFF_ADMIN_NAV_GROUP, SETUP_NAV_GROUP];

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
      <AppShell.Navbar
        className={isCollapsed ? "app-sidebar--collapsed" : undefined}
        style={{
          background: "var(--color-sidebar-bg)",
          borderRight: "1px solid var(--color-sidebar-border)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        aria-label="Main navigation"
      >
        {/* Brand — hidden when collapsed (icons only) */}
        <div className="app-sidebar__top">
          {!isCollapsed ? (
            <Link
              to="/"
              className="app-sidebar__brand"
              onClick={onCloseMobile}
              title="Grove"
            >
              <GroveMark size={20} color="#f0e9d8" />
              <span className="app-sidebar__brand-text">Grove</span>
            </Link>
          ) : null}
        </div>

        {/* Main nav */}
        <nav className="app-sidebar__nav" aria-label="Main">
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.label}>
              {isCollapsed && groupIndex > 0 ? (
                <div
                  style={{
                    height: 1,
                    margin: "8px 12px",
                    background: "rgba(255,255,255,0.06)",
                  }}
                />
              ) : null}
              {!isCollapsed ? (
                <div
                  className="sidebar-group-label"
                  style={{
                    padding: "14px 16px 4px",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "rgba(207,216,210,0.55)",
                    fontWeight: 600,
                  }}
                >
                  {group.label}
                </div>
              ) : null}
              {group.items.map(({ to, end, label, Icon }) => (
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
            </div>
          ))}
        </nav>

        {/* Bottom: collapse toggle */}
        <div className="app-sidebar__footer">
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
      </AppShell.Navbar>
    </>
  );
}
