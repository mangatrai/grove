import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

export type ReminderHorizon = "30d" | "7d" | "1d";

export interface DeadlineReminderItem {
  title: string;
  description: string | null;
  dueDate: string;
  daysUntil: number;
  horizon: ReminderHorizon;
}

export interface DeadlineReminderTemplateInput {
  items: DeadlineReminderItem[];
}

function horizonLabel(horizon: ReminderHorizon, daysUntil: number): string {
  if (horizon === "1d") return daysUntil <= 0 ? "Due today" : "Due tomorrow";
  if (horizon === "7d") return `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  return `Due in ${daysUntil} days`;
}

function horizonBadgeColor(horizon: ReminderHorizon): string {
  if (horizon === "1d") return "#dc2626";
  if (horizon === "7d") return "#d97706";
  return "#2d6a4f";
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function renderDeadlineReminderTemplate({ items }: DeadlineReminderTemplateInput): EmailTemplate {
  const count = items.length;
  const subject = count === 1
    ? `Deadline reminder: ${items[0].title}`
    : `Deadline reminders: ${count} upcoming`;

  const itemsHtml = items
    .map(item => {
      const color = horizonBadgeColor(item.horizon);
      const label = horizonLabel(item.horizon, item.daysUntil);
      const desc = item.description
        ? `<p style="margin:6px 0 0;color:#4b5563;font-size:14px;line-height:1.5;">${item.description}</p>`
        : "";
      return `
        <div style="padding:14px 0;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="display:inline-block;padding:2px 10px;border-radius:12px;background:${color};color:#fff;font-size:12px;font-weight:600;white-space:nowrap;">${label}</span>
          </div>
          <p style="margin:6px 0 0;font-size:16px;font-weight:600;color:#111827;">${item.title}</p>
          <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${formatDate(item.dueDate)}</p>
          ${desc}
        </div>`;
    })
    .join("");

  const html = layout({
    title: subject,
    content: `
      <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;">
        ${count === 1 ? "Upcoming deadline" : `${count} upcoming deadlines`}
      </h1>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6;">
        ${count === 1 ? "The following deadline is approaching." : "The following deadlines are approaching."}
      </p>
      <div style="border-top:1px solid #f3f4f6;">${itemsHtml}</div>
      <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
        Open the Family → Deadlines page to mark items complete or adjust dates.
      </p>
    `,
  });

  const textLines = items.map(item => {
    const label = horizonLabel(item.horizon, item.daysUntil);
    const parts = [`${label}: ${item.title}`, `  Due: ${formatDate(item.dueDate)}`];
    if (item.description) parts.push(`  ${item.description}`);
    return parts.join("\n");
  });

  const text = [subject, "", ...textLines, "", "Open the app to manage your deadlines."].join("\n");

  return { subject, html, text };
}
