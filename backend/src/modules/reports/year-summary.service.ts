import crypto from "node:crypto";
import OpenAI from "openai";
import { qAll, qExec, qGet } from "../../db/query.js";
import { sendMail } from "../mailer/mailer.service.js";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import type {
  YearSummaryCategory,
  YearSummaryData,
  YearSummaryInvestments,
  YearSummaryPayslipData,
  YearSummaryResponse,
} from "./year-summary.types.js";

// Schema facts (do not guess):
//   transaction_canonical: txn_date TEXT, amount NUMERIC (positive=income, negative=spending),
//     status TEXT ('posted' = active), merchant TEXT, created_at TIMESTAMPTZ, no updated_at
//   account_balance_snapshot: as_of_date DATE, updated_at TIMESTAMPTZ
//   payslip_snapshot: pay_date TEXT, updated_at TIMESTAMPTZ
//   payslip_line_item: section IN ('earnings','pre_tax_deductions','post_tax_deductions',
//     'tax_deductions','other_deductions','other_information','taxable_earnings')

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Income / spending ────────────────────────────────────────────────────────

async function computeIncomeSpending(householdId: string, year: number) {
  const rows = await qAll<{ month: number; income: string; spending: string }>(
    `SELECT
       EXTRACT(MONTH FROM txn_date::date)::int AS month,
       SUM(CASE WHEN amount > 0 THEN amount  ELSE 0 END) AS income,
       SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS spending
     FROM transaction_canonical
     WHERE household_id = ?
       AND txn_date >= ? AND txn_date < ?
       AND status = 'posted'
     GROUP BY EXTRACT(MONTH FROM txn_date::date)`,
    householdId, `${year}-01-01`, `${year + 1}-01-01`,
  );
  const monthlyIncome = Array<number>(12).fill(0);
  const monthlySpending = Array<number>(12).fill(0);
  for (const r of rows) {
    monthlyIncome[r.month - 1] = Number(r.income);
    monthlySpending[r.month - 1] = Number(r.spending);
  }
  const income = monthlyIncome.reduce((a, b) => a + b, 0);
  const spending = monthlySpending.reduce((a, b) => a + b, 0);
  return { monthlyIncome, monthlySpending, income, spending };
}

// ── Top categories ───────────────────────────────────────────────────────────

async function computeTopCategories(
  householdId: string,
  year: number,
  totalSpend: number,
): Promise<YearSummaryCategory[]> {
  const rows = await qAll<{ name: string | null; amount: string }>(
    `SELECT COALESCE(c.name, 'Uncategorized') AS name, SUM(-tc.amount) AS amount
     FROM transaction_canonical tc
     LEFT JOIN category c ON c.id = tc.category_id
     WHERE tc.household_id = ?
       AND tc.txn_date >= ? AND tc.txn_date < ?
       AND tc.amount < 0
       AND tc.status = 'posted'
     GROUP BY c.name
     ORDER BY SUM(-tc.amount) DESC
     LIMIT 5`,
    householdId, `${year}-01-01`, `${year + 1}-01-01`,
  );
  return rows.map((r) => ({
    name: r.name ?? "Uncategorized",
    amount: Number(r.amount),
    pct: totalSpend > 0 ? (Number(r.amount) / totalSpend) * 100 : 0,
  }));
}

// ── Balance snapshots ────────────────────────────────────────────────────────

async function computeBalanceSnapshot(householdId: string, asOfDate: string): Promise<number> {
  const row = await qGet<{ total: string | null }>(
    `SELECT SUM(sub.amount) AS total
     FROM (
       SELECT DISTINCT ON (abs.financial_account_id) abs.amount
       FROM account_balance_snapshot abs
       WHERE abs.household_id = ?
         AND abs.as_of_date <= ?::date
       ORDER BY abs.financial_account_id, abs.as_of_date DESC
     ) sub`,
    householdId, asOfDate,
  );
  return Number(row?.total ?? 0);
}

async function computeBalanceSnapshotByType(
  householdId: string,
  asOfDate: string,
  accountTypes: string[],
): Promise<number> {
  const row = await qGet<{ total: string | null }>(
    `SELECT SUM(sub.amount) AS total
     FROM (
       SELECT DISTINCT ON (abs.financial_account_id) abs.amount
       FROM account_balance_snapshot abs
       JOIN financial_account fa ON fa.id = abs.financial_account_id
       WHERE abs.household_id = ?
         AND abs.as_of_date <= ?::date
         AND fa.type = ANY(?)
       ORDER BY abs.financial_account_id, abs.as_of_date DESC
     ) sub`,
    householdId, asOfDate, accountTypes,
  );
  return Number(row?.total ?? 0);
}

// ── Notable transactions ─────────────────────────────────────────────────────

async function computeLargestTransaction(householdId: string, year: number) {
  const row = await qGet<{
    amount: string;
    merchant: string | null;
    memo: string | null;
    txn_date: string;
    category: string | null;
  }>(
    `SELECT -tc.amount AS amount, tc.merchant, tc.memo, tc.txn_date, COALESCE(c.name, NULL) AS category
     FROM transaction_canonical tc
     LEFT JOIN category c ON c.id = tc.category_id
     WHERE tc.household_id = ?
       AND tc.txn_date >= ? AND tc.txn_date < ?
       AND tc.amount < 0
       AND tc.status = 'posted'
     ORDER BY tc.amount ASC
     LIMIT 1`,
    householdId, `${year}-01-01`, `${year + 1}-01-01`,
  );
  if (!row) return null;
  return {
    amount: Number(row.amount),
    description: row.merchant ?? row.memo ?? "Unknown",
    date: row.txn_date,
    category: row.category,
  };
}

async function computeTopMerchant(householdId: string, year: number) {
  const row = await qGet<{ name: string; visits: string; total_spent: string }>(
    `SELECT
       merchant AS name,
       COUNT(*)::int AS visits,
       SUM(-amount) AS total_spent
     FROM transaction_canonical
     WHERE household_id = ?
       AND txn_date >= ? AND txn_date < ?
       AND amount < 0
       AND status = 'posted'
       AND merchant IS NOT NULL AND merchant != ''
     GROUP BY merchant
     ORDER BY COUNT(*) DESC
     LIMIT 1`,
    householdId, `${year}-01-01`, `${year + 1}-01-01`,
  );
  if (!row) return null;
  const visits = Number(row.visits);
  const totalSpent = Number(row.total_spent);
  return { name: row.name, visits, totalSpent, avgPerVisit: visits > 0 ? totalSpent / visits : 0 };
}

// ── Payslip data ─────────────────────────────────────────────────────────────

async function computePayslipData(householdId: string, year: number): Promise<YearSummaryPayslipData | null> {
  const snapshots = await qAll<{
    id: string;
    effective_federal_rate_ytd: string | null;
    effective_total_tax_rate_ytd: string | null;
    gross_pay_ytd: string;
    pre_tax_deductions_ytd: string;
    post_tax_deductions_ytd: string;
  }>(
    `SELECT DISTINCT ON (owner_person_profile_id)
       id,
       effective_federal_rate_ytd,
       effective_total_tax_rate_ytd,
       gross_pay_ytd,
       pre_tax_deductions_ytd,
       post_tax_deductions_ytd
     FROM payslip_snapshot
     WHERE household_id = ?
       AND pay_date >= ? AND pay_date < ?
     ORDER BY owner_person_profile_id, pay_date DESC`,
    householdId, `${year}-01-01`, `${year + 1}-01-01`,
  );

  if (!snapshots.length) return null;

  const totalGrossYtd = snapshots.reduce((a, s) => a + Number(s.gross_pay_ytd ?? 0), 0);
  const preTaxContributionsYtd = snapshots.reduce((a, s) => a + Number(s.pre_tax_deductions_ytd ?? 0), 0);
  const postTaxContributionsYtd = snapshots.reduce((a, s) => a + Number(s.post_tax_deductions_ytd ?? 0), 0);
  const effectiveFederalRatePct = Number(snapshots[0].effective_federal_rate_ytd ?? 0);
  const effectiveTotalRatePct = Number(snapshots[0].effective_total_tax_rate_ytd ?? 0);

  const snapshotIds = snapshots.map((s) => s.id);

  // section = 'tax_deductions' is the correct value per schema CHECK constraint
  const taxRow = await qGet<{
    federal_tax_ytd: string;
    state_tax_ytd: string;
    ss_ytd: string;
    medicare_ytd: string;
  }>(
    `SELECT
       SUM(CASE WHEN authority ILIKE '%federal%'                                     THEN amount_ytd ELSE 0 END) AS federal_tax_ytd,
       SUM(CASE WHEN authority ILIKE '%state%'                                       THEN amount_ytd ELSE 0 END) AS state_tax_ytd,
       SUM(CASE WHEN name ILIKE '%social security%' OR name ILIKE '%oasdi%'          THEN amount_ytd ELSE 0 END) AS ss_ytd,
       SUM(CASE WHEN name ILIKE '%medicare%'                                         THEN amount_ytd ELSE 0 END) AS medicare_ytd
     FROM payslip_line_item
     WHERE payslip_snapshot_id = ANY(?)
       AND section = 'tax_deductions'`,
    snapshotIds,
  );

  const federalTaxYtd = Number(taxRow?.federal_tax_ytd ?? 0);
  const stateTaxYtd = Number(taxRow?.state_tax_ytd ?? 0);
  const socialSecurityYtd = Number(taxRow?.ss_ytd ?? 0);
  const medicareTaxYtd = Number(taxRow?.medicare_ytd ?? 0);

  return {
    totalGrossYtd,
    federalTaxYtd,
    stateTaxYtd,
    socialSecurityYtd,
    medicareTaxYtd,
    totalTaxYtd: federalTaxYtd + stateTaxYtd + socialSecurityYtd + medicareTaxYtd,
    effectiveFederalRatePct,
    effectiveTotalRatePct,
    preTaxContributionsYtd,
    postTaxContributionsYtd,
  };
}

// ── Prior year ───────────────────────────────────────────────────────────────

async function computePriorYear(householdId: string, year: number): Promise<YearSummaryData["priorYear"]> {
  const { income, spending } = await computeIncomeSpending(householdId, year);
  if (income === 0 && spending === 0) return null;
  const netSavings = income - spending;
  const savingsRate = income > 0 ? Math.round((netSavings / income) * 1000) / 10 : 0;
  return { income, spending, netSavings, savingsRate };
}

// ── Data hash ────────────────────────────────────────────────────────────────

async function computeDataHash(householdId: string, year: number): Promise<string> {
  const [tc, abs, ps] = await Promise.all([
    qGet<{ cnt: string; max_ts: string | null }>(
      `SELECT COUNT(*)::text AS cnt, MAX(created_at)::text AS max_ts
       FROM transaction_canonical
       WHERE household_id = ? AND txn_date >= ? AND txn_date < ?`,
      householdId, `${year}-01-01`, `${year + 1}-01-01`,
    ),
    qGet<{ cnt: string; max_ts: string | null }>(
      `SELECT COUNT(*)::text AS cnt, MAX(updated_at)::text AS max_ts
       FROM account_balance_snapshot WHERE household_id = ?`,
      householdId,
    ),
    qGet<{ cnt: string; max_ts: string | null }>(
      `SELECT COUNT(*)::text AS cnt, MAX(updated_at)::text AS max_ts
       FROM payslip_snapshot
       WHERE household_id = ? AND pay_date >= ? AND pay_date < ?`,
      householdId, `${year}-01-01`, `${year + 1}-01-01`,
    ),
  ]);
  const input = `${tc?.cnt}:${tc?.max_ts}:${abs?.cnt}:${abs?.max_ts}:${ps?.cnt}:${ps?.max_ts}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ── LLM narrative ────────────────────────────────────────────────────────────

const NARRATIVE_SYSTEM_PROMPT = `You are a personal financial advisor delivering a year-end review to a household client. You have studied their complete annual financial data. Write like a trusted advisor who knows this client well — direct, warm, and specific to their actual numbers. No generic advice, no bullet points, no headers.`;

function buildPrompt(data: YearSummaryData): string {
  const payslipExtra = data.payslip
    ? `\nPayslip aggregates (household YTD): gross ${data.payslip.totalGrossYtd.toFixed(0)}, federal tax ${data.payslip.federalTaxYtd.toFixed(0)}, total tax ${data.payslip.totalTaxYtd.toFixed(0)}, effective federal rate ${data.payslip.effectiveFederalRatePct.toFixed(1)}%, pre-tax contributions ${data.payslip.preTaxContributionsYtd.toFixed(0)}`
    : "";

  return `Write exactly 3 paragraphs reviewing this household's ${data.year} finances. Separate each paragraph with a blank line.

Paragraph 1 — The wins: Lead with what went well. Reference a specific achievement with real numbers — savings, net worth growth, income, or a strong month. Make it clear you studied the data, not a form letter.

Paragraph 2 — Something worth naming: One pattern, shift, or surprise a sharp advisor would notice. If top spending categories are relevant, name the category as a factual observation — do not suggest the household reduce, cut, or rethink it. Spending on family, food, and travel reflects life priorities; acknowledge it without judgment.

Paragraph 3 — One real opportunity: Focus on what they can DO with their momentum — put savings to work, optimise tax efficiency, build a specific reserve, or accelerate a payoff. If payslip data is present and the effective withholding rate reveals an opportunity (over- or under-withholding), mention it here. Do not suggest lifestyle changes or cheaper alternatives for any spending category.

DATA:
${JSON.stringify(
    {
      year: data.year,
      income: data.income,
      spending: data.spending,
      netSavings: data.netSavings,
      savingsRate: data.savingsRate + "%",
      priorYear: data.priorYear,
      topCategories: data.topCategories,
      bestMonth: data.bestMonth,
      worstMonth: data.worstMonth,
      netWorthStart: data.netWorthStart,
      netWorthEnd: data.netWorthEnd,
      netWorthChange: data.netWorthChange,
      investmentGrowth: data.investments,
      largestTransaction: data.largestTransaction,
    },
    null,
    2,
  )}${payslipExtra}`;
}

function parseNarrative(raw: string): string[] {
  const parts = raw.split(/\n\n+/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
  while (parts.length < 3) parts.push("");
  return parts;
}

async function generateNarrative(data: YearSummaryData): Promise<string[]> {
  if (!env.OPENAI_API_KEY) {
    log.warn("year-summary: OPENAI_API_KEY not set, skipping narrative");
    return ["", "", ""];
  }
  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000 });
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 800,
      temperature: 0.7,
      messages: [
        { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(data) },
      ],
    });
    return parseNarrative(completion.choices[0]?.message?.content ?? "");
  } catch (err) {
    log.warn({ err }, "year-summary: narrative generation failed");
    return ["", "", ""];
  }
}

// ── Core data computation ────────────────────────────────────────────────────

async function computeYearSummaryData(householdId: string, year: number): Promise<YearSummaryData> {
  const [{ monthlyIncome, monthlySpending, income, spending }, householdRow] = await Promise.all([
    computeIncomeSpending(householdId, year),
    qGet<{ name: string }>(`SELECT name FROM household WHERE id = ?`, householdId),
  ]);

  const netSavings = income - spending;
  const savingsRate = income > 0 ? Math.round((netSavings / income) * 1000) / 10 : 0;
  const monthlyNet = monthlyIncome.map((inc, i) => inc - monthlySpending[i]);
  const bestMonthIdx = monthlyNet.indexOf(Math.max(...monthlyNet));
  const worstMonthIdx = monthlyNet.indexOf(Math.min(...monthlyNet));

  const INVESTMENT_TYPES = ["investment", "retirement", "brokerage"];
  const BANK_TYPES = ["checking", "savings", "cash", "money_market"];

  const [
    topCategories,
    netWorthStart,
    netWorthEnd,
    investStart,
    investEnd,
    bankStart,
    bankEnd,
    largestTransaction,
    topMerchant,
    payslip,
    priorYear,
  ] = await Promise.all([
    computeTopCategories(householdId, year, spending),
    computeBalanceSnapshot(householdId, `${year}-01-01`),
    computeBalanceSnapshot(householdId, `${year}-12-31`),
    computeBalanceSnapshotByType(householdId, `${year}-01-01`, INVESTMENT_TYPES),
    computeBalanceSnapshotByType(householdId, `${year}-12-31`, INVESTMENT_TYPES),
    computeBalanceSnapshotByType(householdId, `${year}-01-01`, BANK_TYPES),
    computeBalanceSnapshotByType(householdId, `${year}-12-31`, BANK_TYPES),
    computeLargestTransaction(householdId, year),
    computeTopMerchant(householdId, year),
    computePayslipData(householdId, year),
    computePriorYear(householdId, year - 1),
  ]);

  const netWorthChange = netWorthEnd - netWorthStart;
  const netWorthChangePct =
    netWorthStart !== 0 ? Math.round((netWorthChange / Math.abs(netWorthStart)) * 1000) / 10 : 0;
  const investGrowth = investEnd - investStart;
  const investGrowthPct =
    investStart !== 0 ? Math.round((investGrowth / Math.abs(investStart)) * 1000) / 10 : 0;

  const investments: YearSummaryInvestments | null =
    investEnd > 0 || investStart > 0
      ? { start: investStart, end: investEnd, growth: investGrowth, growthPct: investGrowthPct }
      : null;

  return {
    year,
    householdName: householdRow?.name ?? "Your Household",
    income,
    spending,
    netSavings,
    savingsRate,
    monthlyIncome,
    monthlySpending,
    topCategories,
    bestMonth: { month: MONTH_NAMES[bestMonthIdx], netSavings: monthlyNet[bestMonthIdx] },
    worstMonth: { month: MONTH_NAMES[worstMonthIdx], netSavings: monthlyNet[worstMonthIdx] },
    netWorthStart,
    netWorthEnd,
    netWorthChange,
    netWorthChangePct,
    investments,
    otherSavings: bankEnd - bankStart,
    largestTransaction,
    topMerchant,
    priorYear,
    payslip,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getOrGenerateYearSummary(householdId: string, year: number): Promise<YearSummaryResponse> {
  const currentHash = await computeDataHash(householdId, year);

  const cached = await qGet<{
    data_json: string;
    narrative_json: string;
    generated_at: string;
    data_hash: string;
  }>(
    `SELECT data_json, narrative_json, generated_at, data_hash
     FROM year_summary_cache
     WHERE household_id = ? AND year = ?`,
    householdId, year,
  );

  if (cached && cached.data_hash === currentHash) {
    return {
      year,
      data: JSON.parse(cached.data_json) as YearSummaryData,
      narrative: JSON.parse(cached.narrative_json) as string[],
      generatedAt: cached.generated_at,
      fromCache: true,
    };
  }

  const data = await computeYearSummaryData(householdId, year);
  const narrative = await generateNarrative(data);
  const now = new Date().toISOString();

  await qExec(
    `INSERT INTO year_summary_cache
       (household_id, year, data_json, narrative_json, generated_at, data_hash)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (household_id, year) DO UPDATE SET
       data_json      = EXCLUDED.data_json,
       narrative_json = EXCLUDED.narrative_json,
       generated_at   = EXCLUDED.generated_at,
       data_hash      = EXCLUDED.data_hash`,
    householdId, year, JSON.stringify(data), JSON.stringify(narrative), now, currentHash,
  );

  return { year, data, narrative, generatedAt: now, fromCache: false };
}

export async function sendYearSummaryEmail(
  householdId: string,
  year: number,
  toEmail: string,
): Promise<{ ok: boolean; reason?: string }> {
  const summary = await getOrGenerateYearSummary(householdId, year);
  const d = summary.data;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1c1917;">
  <h1 style="color:#2d6a4f;">${d.year} Year in Review</h1>
  <p>Your finances at a glance:</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr><td style="padding:8px 0;border-bottom:1px solid #e7e5e4;"><strong>Total Income</strong></td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e7e5e4;">${fmt(d.income)}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e7e5e4;"><strong>Total Spending</strong></td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e7e5e4;">${fmt(d.spending)}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #e7e5e4;"><strong>Net Savings</strong></td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e7e5e4;">${fmt(d.netSavings)}</td></tr>
    <tr><td style="padding:8px 0;"><strong>Savings Rate</strong></td><td style="text-align:right;padding:8px 0;">${d.savingsRate.toFixed(1)}%</td></tr>
  </table>
  ${summary.narrative[0] ? `<p style="font-style:italic;color:#57534e;">${summary.narrative[0]}</p>` : ""}
  <p><a href="/dashboard" style="background:#2d6a4f;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View your full Year in Review →</a></p>
  <p style="font-size:12px;color:#78716c;">Generated ${new Date(summary.generatedAt).toLocaleDateString()}.</p>
</body></html>`;

  const text = `${d.year} Year in Review\n\nIncome: ${fmt(d.income)}\nSpending: ${fmt(d.spending)}\nNet Savings: ${fmt(d.netSavings)}\nSavings Rate: ${d.savingsRate.toFixed(1)}%\n\n${summary.narrative[0] ?? ""}\n\nView your full Year in Review in the app.`;

  const result = await sendMail({ to: toEmail, subject: `Your ${d.year} Year in Review`, html, text });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true };
}
