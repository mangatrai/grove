import { Link, NavLink } from "react-router-dom";

function navClass(active: boolean): string {
  return active ? "app-sidebar__link app-sidebar__link--active" : "app-sidebar__link";
}

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

const NAV = [
  { to: "/", end: true, label: "Home", abbr: "H" },
  { to: "/net-worth", end: false, label: "Net worth", abbr: "N" },
  { to: "/transactions", end: false, label: "Transactions", abbr: "T" },
  { to: "/payslips", end: false, label: "Payslips", abbr: "P" },
  { to: "/categories", end: false, label: "Categories", abbr: "C" }
] as const;

export function AppSidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: AppSidebarProps) {
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
        className={`app-sidebar ${collapsed && !mobileOpen ? "app-sidebar--collapsed" : ""} ${mobileOpen ? "app-sidebar--mobile-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="app-sidebar__top">
          <Link to="/" className="app-sidebar__brand" onClick={onCloseMobile}>
            <span className="app-sidebar__brand-abbr" aria-hidden>
              HF
            </span>
            <span className="app-sidebar__brand-text">Household Finance</span>
          </Link>
        </div>
        <nav className="app-sidebar__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed && !mobileOpen ? item.label : undefined}
              className={({ isActive }) => navClass(isActive)}
              onClick={onCloseMobile}
            >
              <span className="app-sidebar__link-abbr" aria-hidden>
                {item.abbr}
              </span>
              <span className="app-sidebar__link-text">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <button
            type="button"
            className="app-sidebar__collapse-btn"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden>{collapsed ? "»" : "«"}</span>
            <span className="app-sidebar__collapse-text">{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
