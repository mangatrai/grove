import { type ReactNode } from "react";
import { HelpIcon } from "./HelpIcon";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  helpText?: string;
  /** Right-aligned action buttons / controls */
  actions?: ReactNode;
}

/**
 * Consistent page-level header: h1 title + optional subtitle, optional help
 * tooltip, and right-aligned action slot.
 *
 * @example
 * <PageHeader
 *   title="Budget"
 *   subtitle="April 2026"
 *   helpText="Set monthly spending targets per category..."
 *   actions={<button className="button-primary">Save</button>}
 * />
 */
export function PageHeader({
  title,
  subtitle,
  helpText,
  actions,
}: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header__left">
        <h1 className="page-header__title">
          {title}
          {helpText && (
            <span className="page-header__help">
              <HelpIcon label={helpText} size={16} />
            </span>
          )}
        </h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
