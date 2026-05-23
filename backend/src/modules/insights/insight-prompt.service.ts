import { qAll, qGet } from "../../db/query.js";
import { computeAgeFromDob, decryptDob } from "../household/dob-crypto.js";
import { getBalanceSheet } from "../reports/balance-sheet.service.js";

// ── Flow class taxonomy (parent category IDs) ────────────────────────────────

// Movement: inter-account transfers, CC payment settlement, bank fees — net zero
const MOVEMENT_PARENT_IDS = [
  "30000000-0000-0000-0000-000000000112", // Transfers
  "30000000-0000-0000-0000-000000000104", // Borrowing
  "30000000-0000-0000-0000-000000000153", // Banking
] as const;

const COMMITTED_EXPENSE_PARENT_IDS = [
  "30000000-0000-0000-0000-000000000133", // Loans (mortgage, auto, HELOC)
] as const;

const WEALTH_BUILDING_PARENT_IDS = [
  "30000000-0000-0000-0000-000000000105", // Investments
] as const;

const TAX_PARENT_IDS = [
  "30000000-0000-0000-0000-000000000111", // Taxes
] as const;

const INCOME_PARENT_IDS = [
  "30000000-0000-0000-0000-000000000001", // Income
] as const;

// Non-lifestyle parent IDs — excluded from topCategories and lifestyle spend
const NON_LIFESTYLE_PARENT_IDS = [
  ...MOVEMENT_PARENT_IDS,
  ...COMMITTED_EXPENSE_PARENT_IDS,
  ...WEALTH_BUILDING_PARENT_IDS,
  ...TAX_PARENT_IDS,
  ...INCOME_PARENT_IDS,
] as const;

// SQL literal list for use in NOT IN clauses (safe: compile-time constants only)
const NON_LIFESTYLE_SQL = NON_LIFESTYLE_PARENT_IDS.map((id) => `'${id}'`).join(", ");

// Excluded from over-budget alerts and topCategories (movement/investment/tax/income but NOT loans)
const NON_BUDGET_ALERT_PARENT_IDS = [
  ...MOVEMENT_PARENT_IDS,
  ...WEALTH_BUILDING_PARENT_IDS,
  ...TAX_PARENT_IDS,
  ...INCOME_PARENT_IDS,
] as const;
const NON_BUDGET_ALERT_SQL = NON_BUDGET_ALERT_PARENT_IDS.map((id) => `'${id}'`).join(", ");

// ── InsightPromptInput ────────────────────────────────────────────────────────

export interface InsightPromptInput {
  headOfHousehold: { age: number | null; sex: string | null };
  spouse: { age: number | null; sex: string | null } | null;
  city: string | null;
  state: string | null;
  grossIncomeUsd: number | null;
  householdMemberCount: number;
  riskTolerance: string | null;
  financialGoals: string[];

  netWorth: {
    checkingSavingsTotal: number;
    investmentTotal: number;
    retirementTotal: number;
    healthSavingsTotal: number;
    educationSavingsTotal: number;
    creditCardLiabilities: number;
    loanLiabilities: number;
    netWorth: number;
    missingAccountTypes: string[];
  };

  /** Monthly avg income (Income category only, excl. transfer-paired rows), 12-month window. */
  avgMonthlyInflow: number;
  /** Monthly avg lifestyle spend (Shopping, Food, Home, etc.), 12-month window, excl. uncategorized. */
  avgMonthlyLifestyleSpend: number;
  /** Monthly avg committed loan obligations (mortgage, auto, HELOC), 12-month window. */
  avgMonthlyCommittedExpenses: number;
  /**
   * Cash buffer rate = (income - lifestyle - committed) / income.
   * Measures what fraction of take-home is left after lifestyle and loan obligations.
   */
  cashBufferRate: number;

  /** Top lifestyle spend categories by avg monthly outflow (movement/investment/tax excluded). */
  topCategories: Array<{ name: string; avgMonthlySpend: number }>;
  /** Monthly avg of uncategorized debits — reported separately so the LLM doesn't treat it as a category. */
  uncategorizedMonthlyAvg: number;

  /**
   * Total investment portfolio balance per month for the last 6 months.
   * Covers accounts of type: investment, retirement, health (HSA), education (529).
   * NOTE: month-over-month changes reflect both contributions AND market movements.
   */
  investmentPortfolioTrend: Array<{ month: string; totalBalance: number }>;

  confirmedRecurring: Array<{ merchantName: string; monthlyAmount: number }>;
  overBudgetCategories: Array<{ name: string; avgOverageUsd: number; monthsOver: number }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function shiftMonthBack(yyyyMm: string, n: number): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentUtcYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function loadHouseholdDemographics(householdId: string): Promise<{
  city: string | null;
  state: string | null;
  combinedGrossIncomeUsd: number | null;
  memberCount: number;
}> {
  const h = await qGet<{ city: string | null; state: string | null; combined_gross_income_usd: number | null }>(
    `SELECT city, state, combined_gross_income_usd
       FROM household WHERE id = ?`,
    householdId
  );
  const cntRow = await qGet<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM household_membership WHERE household_id = ?`,
    householdId
  );
  return {
    city: h?.city?.trim() ? String(h.city) : null,
    state: h?.state?.trim() ? String(h.state) : null,
    combinedGrossIncomeUsd:
      h?.combined_gross_income_usd != null && Number.isFinite(Number(h.combined_gross_income_usd))
        ? Number(h.combined_gross_income_usd)
        : null,
    memberCount: Number(cntRow?.c ?? 0)
  };
}

type ProfileRow = {
  relationship: string;
  age: number | null;
  date_of_birth_encrypted: string | null;
  sex: string | null;
  risk_tolerance: string | null;
  financial_goals_json: string | null;
  individual_gross_income_usd: number | null;
};

async function loadProfileRows(householdId: string): Promise<ProfileRow[]> {
  return qAll<ProfileRow>(
    `SELECT m.relationship,
            p.age,
            p.date_of_birth_encrypted,
            p.sex,
            p.risk_tolerance,
            p.financial_goals_json,
            p.individual_gross_income_usd
       FROM person_profile p
       JOIN household_membership m
         ON m.person_profile_id = p.id AND m.household_id = p.household_id
      WHERE p.household_id = ?
      ORDER BY p.created_at ASC`,
    householdId
  );
}

/** Compute effective age from a profile-like row: decrypted DOB first, manual age fallback. */
function effectiveAgeFromRow(row: { age: number | null; date_of_birth_encrypted: string | null } | undefined | null): number | null {
  if (!row) return null;
  if (row.date_of_birth_encrypted != null) {
    const dob = decryptDob(String(row.date_of_birth_encrypted));
    if (dob != null) {
      const computed = computeAgeFromDob(dob);
      if (computed != null) return computed;
    }
  }
  return row.age != null && Number.isFinite(Number(row.age)) ? Number(row.age) : null;
}

function parseGoals(json: string | null): string[] {
  if (!json?.trim()) {
    return [];
  }
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

async function buildNetWorthBlock(householdId: string): Promise<InsightPromptInput["netWorth"]> {
  const asOf = new Date().toISOString().slice(0, 10);
  const sheet = await getBalanceSheet(householdId, asOf);

  let checkingSavingsTotal = 0;
  let investmentTotal = 0;
  let retirementTotal = 0;
  let healthSavingsTotal = 0;
  let educationSavingsTotal = 0;
  let creditCardLiabilities = 0;
  let loanLiabilities = 0;

  const activeAssets = sheet.assets.filter((a) => a.status !== "closed");
  const activeLiabilities = sheet.liabilities.filter((a) => a.status !== "closed");

  for (const a of activeAssets) {
    const b = a.balance ?? 0;
    if (a.type === "checking" || a.type === "savings" || a.type === "cash") {
      checkingSavingsTotal += b;
    } else if (a.type === "investment") {
      investmentTotal += b;
    } else if (a.type === "retirement") {
      retirementTotal += b;
    } else if (a.type === "health") {
      healthSavingsTotal += b;
    } else if (a.type === "education") {
      educationSavingsTotal += b;
    }
  }
  for (const l of activeLiabilities) {
    const b = Math.abs(l.balance ?? 0);
    if (l.type === "credit_card") {
      creditCardLiabilities += b;
    } else if (l.type === "loan") {
      loanLiabilities += b;
    }
  }

  const assetsSum = checkingSavingsTotal + investmentTotal + retirementTotal + healthSavingsTotal + educationSavingsTotal;
  const liabSum = creditCardLiabilities + loanLiabilities;
  const netWorth = assetsSum - liabSum;

  const types = await qAll<{ type: string }>(
    `SELECT DISTINCT type FROM financial_account WHERE household_id = ? AND type <> 'payslip' AND status = 'active'`,
    householdId
  );
  const typeSet = new Set(types.map((t) => t.type));
  const missingAccountTypes: string[] = [];
  if (!typeSet.has("retirement")) {
    missingAccountTypes.push("retirement");
  }

  return {
    checkingSavingsTotal: round2(checkingSavingsTotal),
    investmentTotal: round2(investmentTotal),
    retirementTotal: round2(retirementTotal),
    healthSavingsTotal: round2(healthSavingsTotal),
    educationSavingsTotal: round2(educationSavingsTotal),
    creditCardLiabilities: round2(creditCardLiabilities),
    loanLiabilities: round2(loanLiabilities),
    netWorth: round2(netWorth),
    missingAccountTypes
  };
}

/**
 * Returns income, lifestyle spend, committed loan spend, and uncategorized spend
 * over the trailing 12 months. Uses flow-class taxonomy to separate categories.
 */
async function flowBreakdown12m(householdId: string, userId: string | null): Promise<{
  inflow12: number;
  lifestyleSpend12: number;
  committedExpenses12: number;
  uncategorized12: number;
}> {
  const userClause = userId ? " AND tc.user_id = ? " : "";
  const params: unknown[] = [householdId];
  if (userId) params.push(userId);

  const row = await qGet<{ inf: string | number; life: string | number; committed: string | number; uncat: string | number }>(
    `SELECT
        COALESCE(SUM(CASE
          WHEN tc.amount > 0
            AND COALESCE(p.id, c.id) = '30000000-0000-0000-0000-000000000001'
          THEN tc.amount ELSE 0
        END), 0) AS inf,
        COALESCE(SUM(CASE
          WHEN tc.amount < 0
            AND tc.category_id IS NOT NULL
            AND COALESCE(p.id, c.id) NOT IN (${NON_LIFESTYLE_SQL})
          THEN -tc.amount ELSE 0
        END), 0) AS life,
        COALESCE(SUM(CASE
          WHEN tc.amount < 0
            AND COALESCE(p.id, c.id) = '30000000-0000-0000-0000-000000000133'
          THEN -tc.amount ELSE 0
        END), 0) AS committed,
        COALESCE(SUM(CASE
          WHEN tc.amount < 0 AND tc.category_id IS NULL
          THEN -tc.amount ELSE 0
        END), 0) AS uncat
       FROM transaction_canonical tc
       LEFT JOIN category c ON c.id = tc.category_id
       LEFT JOIN category p ON p.id = c.parent_id
      WHERE tc.household_id = ?
        AND tc.status = 'posted'
        AND tc.transfer_group_id IS NULL
        AND tc.txn_date >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - interval '12 months', 'YYYY-MM-DD')
        ${userClause}`,
    ...params
  );
  return {
    inflow12: Number(row?.inf ?? 0),
    lifestyleSpend12: Number(row?.life ?? 0),
    committedExpenses12: Number(row?.committed ?? 0),
    uncategorized12: Number(row?.uncat ?? 0)
  };
}

/**
 * Top lifestyle spend categories by avg monthly outflow.
 * Excludes: movement (Transfers/Borrowing/Banking), Investments, Taxes, Income, Loans, uncategorized.
 * Loans are excluded here because avgMonthlyCommittedExpenses already captures them.
 */
async function topSpendCategories12m(
  householdId: string,
  userId: string | null
): Promise<Array<{ name: string; avgMonthlySpend: number }>> {
  const userClause = userId ? " AND tc.user_id = ? " : "";
  const params: unknown[] = [householdId];
  if (userId) params.push(userId);

  const rows = await qAll<{ cat_name: string; total_spend: string | number }>(
    `SELECT cat_name, total_spend FROM (
        SELECT
          COALESCE(p.name, c.name) AS cat_name,
          COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS total_spend
        FROM transaction_canonical tc
        LEFT JOIN category c ON c.id = tc.category_id
        LEFT JOIN category p ON p.id = c.parent_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.transfer_group_id IS NULL
         AND tc.category_id IS NOT NULL
         AND COALESCE(p.id, c.id) NOT IN (${NON_LIFESTYLE_SQL})
         AND tc.txn_date >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - interval '12 months', 'YYYY-MM-DD')
         ${userClause}
       GROUP BY COALESCE(p.name, c.name)
     ) t
     ORDER BY total_spend DESC
     LIMIT 10`,
    ...params
  );
  return rows.map((r) => ({
    name: r.cat_name,
    avgMonthlySpend: round2(Number(r.total_spend) / 12)
  }));
}

/**
 * Total investment portfolio balance (investment + retirement + health + education accounts)
 * per month over the last 6 months, taking the latest snapshot per account per month.
 * Note: values reflect both contributions and market movements.
 */
async function investmentPortfolioTrend(householdId: string): Promise<Array<{ month: string; totalBalance: number }>> {
  const rows = await qAll<{ month: string; total_balance: string | number }>(
    `WITH ranked AS (
       SELECT
         snap.financial_account_id,
         LEFT(snap.as_of_date::text, 7) AS month,
         snap.amount,
         ROW_NUMBER() OVER (
           PARTITION BY snap.financial_account_id, LEFT(snap.as_of_date::text, 7)
           ORDER BY snap.as_of_date DESC
         ) AS rn
       FROM account_balance_snapshot snap
       JOIN financial_account fa ON fa.id = snap.financial_account_id AND fa.household_id = snap.household_id
       WHERE fa.household_id = ?
         AND fa.type IN ('investment', 'retirement', 'health', 'education')
         AND snap.as_of_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - interval '6 months'
     )
     SELECT month, SUM(amount)::numeric AS total_balance
     FROM ranked
     WHERE rn = 1
     GROUP BY month
     ORDER BY month`,
    householdId
  );
  return rows.map((r) => ({
    month: r.month,
    totalBalance: round2(Number(r.total_balance))
  }));
}

async function confirmedRecurringRows(householdId: string): Promise<Array<{ merchantName: string; monthlyAmount: number }>> {
  const rows = await qAll<{ name: string; amt: string | number }>(
    `SELECT COALESCE(NULLIF(TRIM(display_name), ''), merchant_key) AS name, amount_anchor AS amt
       FROM recurring_merchant_override
      WHERE household_id = ?
        AND verdict = 'confirmed'
        AND amount_anchor IS NOT NULL`,
    householdId
  );
  return rows.map((r) => ({
    merchantName: r.name,
    monthlyAmount: round2(Number(r.amt))
  }));
}

async function overBudgetCategories(
  householdId: string,
  userId: string | null
): Promise<Array<{ name: string; avgOverageUsd: number; monthsOver: number }>> {
  const ym = currentUtcYearMonth();
  const months = [shiftMonthBack(ym, 0), shiftMonthBack(ym, 1), shiftMonthBack(ym, 2)];

  // Only alert on lifestyle + committed expenses (loans). Exclude movement/investments/taxes/income.
  const budgetRows = await qAll<{ category_id: string; month: string; amount: string | number; cat_name: string }>(
    `SELECT bc.category_id, bc.month, bc.amount, COALESCE(p.name, c.name) AS cat_name
       FROM budget_category bc
       JOIN category c ON c.id = bc.category_id
       LEFT JOIN category p ON p.id = c.parent_id
      WHERE bc.household_id = ?
        AND bc.month IN (?, ?, ?)
        AND (
          (c.parent_id IS NOT NULL AND c.parent_id NOT IN (${NON_BUDGET_ALERT_SQL}))
          OR
          (c.parent_id IS NULL AND bc.category_id NOT IN (${NON_BUDGET_ALERT_SQL}))
        )`,
    householdId,
    months[0],
    months[1],
    months[2]
  );
  const userClause = userId ? " AND tc.user_id = ? " : "";
  const spentRows = await qAll<{ category_id: string; month: string; spent: string | number }>(
    `SELECT
        bc.category_id,
        bc.month,
        COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS spent
       FROM budget_category bc
       LEFT JOIN transaction_canonical tc
         ON tc.household_id = bc.household_id
        AND tc.status = 'posted'
        AND tc.transfer_group_id IS NULL
        AND tc.category_id = bc.category_id
        AND tc.txn_date >= to_char(to_date(bc.month || '-01', 'YYYY-MM-DD'), 'YYYY-MM-DD')
        AND tc.txn_date < to_char(to_date(bc.month || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM-DD')
        ${userClause}
      WHERE bc.household_id = ?
        AND bc.month IN (?, ?, ?)
      GROUP BY bc.category_id, bc.month`,
    ...(userId ? [userId] : []),
    householdId,
    months[0],
    months[1],
    months[2]
  );
  const spentByCategoryMonth = new Map<string, number>(
    spentRows.map((row) => [`${row.category_id}:${row.month}`, Number(row.spent ?? 0)])
  );

  type Agg = { name: string; overages: number[] };
  const byCat = new Map<string, Agg>();

  for (const br of budgetRows) {
    const budgeted = Number(br.amount);
    const spent = spentByCategoryMonth.get(`${br.category_id}:${br.month}`) ?? 0;
    if (spent > budgeted) {
      const key = br.category_id;
      const name = br.cat_name || "Category";
      let agg = byCat.get(key);
      if (!agg) {
        agg = { name, overages: [] };
        byCat.set(key, agg);
      }
      agg.overages.push(spent - budgeted);
    }
  }

  const out: Array<{ name: string; avgOverageUsd: number; monthsOver: number }> = [];
  for (const agg of byCat.values()) {
    const monthsOver = agg.overages.length;
    if (monthsOver >= 2) {
      const avgOver = agg.overages.reduce((a, b) => a + b, 0) / agg.overages.length;
      out.push({
        name: agg.name,
        avgOverageUsd: round2(avgOver),
        monthsOver
      });
    }
  }
  return out;
}

export async function assembleHouseholdPromptInput(householdId: string): Promise<InsightPromptInput> {
  const demo = await loadHouseholdDemographics(householdId);
  const profiles = await loadProfileRows(householdId);

  const self = profiles.find((p) => p.relationship === "self");
  const spouse = profiles.find((p) => p.relationship === "spouse");

  const headOfHousehold = {
    age: effectiveAgeFromRow(self),
    sex: self?.sex != null ? String(self.sex) : null
  };
  const spouseBlock =
    spouse != null
      ? {
          age: effectiveAgeFromRow(spouse),
          sex: spouse.sex != null ? String(spouse.sex) : null
        }
      : null;

  const riskTolerance = self?.risk_tolerance != null ? String(self.risk_tolerance) : null;
  const financialGoals = self ? parseGoals(self.financial_goals_json) : [];

  const netWorth = await buildNetWorthBlock(householdId);
  const { inflow12, lifestyleSpend12, committedExpenses12, uncategorized12 } = await flowBreakdown12m(householdId, null);

  const avgMonthlyInflow = round2(inflow12 / 12);
  const avgMonthlyLifestyleSpend = round2(lifestyleSpend12 / 12);
  const avgMonthlyCommittedExpenses = round2(committedExpenses12 / 12);
  const cashBufferRate =
    inflow12 > 0 ? round2((inflow12 - lifestyleSpend12 - committedExpenses12) / inflow12) : 0;
  const uncategorizedMonthlyAvg = round2(uncategorized12 / 12);

  const topCategories = await topSpendCategories12m(householdId, null);
  const portfolioTrend = await investmentPortfolioTrend(householdId);
  const confirmedRecurring = await confirmedRecurringRows(householdId);
  const overBudget = await overBudgetCategories(householdId, null);

  return {
    headOfHousehold,
    spouse: spouseBlock,
    city: demo.city,
    state: demo.state,
    grossIncomeUsd: demo.combinedGrossIncomeUsd,
    householdMemberCount: demo.memberCount,
    riskTolerance,
    financialGoals,
    netWorth,
    avgMonthlyInflow,
    avgMonthlyLifestyleSpend,
    avgMonthlyCommittedExpenses,
    cashBufferRate,
    topCategories,
    uncategorizedMonthlyAvg,
    investmentPortfolioTrend: portfolioTrend,
    confirmedRecurring,
    overBudgetCategories: overBudget
  };
}

export async function assemblePersonalPromptInput(householdId: string, userId: string): Promise<InsightPromptInput> {
  const demo = await loadHouseholdDemographics(householdId);
  const row = await qGet<{
    age: number | null;
    date_of_birth_encrypted: string | null;
    sex: string | null;
    risk_tolerance: string | null;
    financial_goals_json: string | null;
    individual_gross_income_usd: number | null;
  }>(
    `SELECT p.age, p.date_of_birth_encrypted, p.sex, p.risk_tolerance, p.financial_goals_json, p.individual_gross_income_usd
       FROM person_profile p
      WHERE p.household_id = ? AND p.linked_user_id = ?
      LIMIT 1`,
    householdId,
    userId
  );

  const cntRow = await qGet<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM household_membership WHERE household_id = ?`,
    householdId
  );

  const netWorth = await buildNetWorthBlock(householdId);
  const { inflow12, lifestyleSpend12, committedExpenses12, uncategorized12 } = await flowBreakdown12m(householdId, userId);

  const avgMonthlyInflow = round2(inflow12 / 12);
  const avgMonthlyLifestyleSpend = round2(lifestyleSpend12 / 12);
  const avgMonthlyCommittedExpenses = round2(committedExpenses12 / 12);
  const cashBufferRate =
    inflow12 > 0 ? round2((inflow12 - lifestyleSpend12 - committedExpenses12) / inflow12) : 0;
  const uncategorizedMonthlyAvg = round2(uncategorized12 / 12);

  const topCategories = await topSpendCategories12m(householdId, userId);
  const portfolioTrend = await investmentPortfolioTrend(householdId);
  const confirmedRecurring = await confirmedRecurringRows(householdId);
  const overBudget = await overBudgetCategories(householdId, userId);

  return {
    headOfHousehold: {
      age: effectiveAgeFromRow(row),
      sex: row?.sex != null ? String(row.sex) : null
    },
    spouse: null,
    city: demo.city,
    state: demo.state,
    grossIncomeUsd:
      row?.individual_gross_income_usd != null && Number.isFinite(Number(row.individual_gross_income_usd))
        ? Number(row.individual_gross_income_usd)
        : null,
    householdMemberCount: Number(cntRow?.c ?? 0),
    riskTolerance: row?.risk_tolerance != null ? String(row.risk_tolerance) : null,
    financialGoals: row ? parseGoals(row.financial_goals_json) : [],
    netWorth,
    avgMonthlyInflow,
    avgMonthlyLifestyleSpend,
    avgMonthlyCommittedExpenses,
    cashBufferRate,
    topCategories,
    uncategorizedMonthlyAvg,
    investmentPortfolioTrend: portfolioTrend,
    confirmedRecurring,
    overBudgetCategories: overBudget
  };
}
