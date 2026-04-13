import { type ReactNode } from "react";
import { HelpIcon } from "./HelpIcon";

interface SectionCardProps {
  title?: string;
  helpText?: string;
  /** Right slot for heading row — e.g. a compact action button */
  headerAction?: ReactNode;
  children: ReactNode;
  /** Extra CSS classes applied to the outer .card element */
  className?: string;
}

/**
 * A titled card section — replaces ad-hoc `<div class="card">` + `<h2>`
 * patterns. Provides consistent spacing and an optional help tooltip.
 *
 * @example
 * <SectionCard title="Income & Payroll" helpText="One point per pay date...">
 *   <PayslipIncomeCharts ... />
 * </SectionCard>
 */
export function SectionCard({
  title,
  helpText,
  headerAction,
  children,
  className,
}: SectionCardProps) {
  const classes = ["card", "section-card", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {(title || headerAction) && (
        <div className="section-card__header">
          {title && (
            <h2 className="section-card__title">
              {title}
              {helpText && (
                <span className="section-card__help">
                  <HelpIcon label={helpText} size={14} />
                </span>
              )}
            </h2>
          )}
          {headerAction && (
            <div className="section-card__action">{headerAction}</div>
          )}
        </div>
      )}
      <div className="section-card__body">{children}</div>
    </div>
  );
}
