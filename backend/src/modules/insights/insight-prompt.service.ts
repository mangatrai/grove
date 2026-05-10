import { qAll, qGet } from "../../db/query.js";
import { getBalanceSheet } from "../reports/balance-sheet.service.js";

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
    creditCardLiabilities: number;
    loanLiabilities: number;
    netWorth: number;
    missingAccountTypes: string[];
  };

  avgMonthlyInflow: number;
  avgMonthlyOutflow: number;
  avgMonthlySavingsRate: number;

  topCategories: Array<{ name: string; avgMonthlySpend: number }>;

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
  sex: string | null;
  risk_tolerance: string | null;
  financial_goals_json: string | null;
  individual_gross_income_usd: number | null;
};

async function loadProfileRows(householdId: string): Promise<ProfileRow[]> {
  return qAll<ProfileRow>(
    `SELECT m.relationship,
            p.age,
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
  let creditCardLiabilities = 0;
  let loanLiabilities = 0;

  for (const a of sheet.assets) {
    const b = a.balance ?? 0;
    if (a.type === "checking" || a.type === "savings") {
      checkingSavingsTotal += b;
    } else if (a.type === "investment") {
      investmentTotal += b;
    } else if (a.type === "retirement") {
      retirementTotal += b;
    }
  }
  for (const l of sheet.liabilities) {
    const b = Math.abs(l.balance ?? 0);
    if (l.type === "credit_card") {
      creditCardLiabilities += b;
    } else if (l.type === "loan") {
      loanLiabilities += b;
    }
  }

  const assetsSum = checkingSavingsTotal + investmentTotal + retirementTotal;
  const liabSum = creditCardLiabilities + loanLiabilities;
  const netWorth = assetsSum - liabSum;

  const types = await qAll<{ type: string }>(
    `SELECT DISTINCT type FROM financial_account WHERE household_id = ? AND type <> 'payslip'`,
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
    creditCardLiabilities: round2(creditCardLiabilities),
    loanLiabilities: round2(loanLiabilities),
    netWorth: round2(netWorth),
    missingAccountTypes
  };
}

async function flowTotals12m(householdId: string, userId: string | null): Promise<{
  inflow12: number;
  outflow12: number;
}> {
  const userClause = userId ? " AND tc.user_id = ? " : "";
  const params: unknown[] = [householdId];
  if (userId) {
    params.push(userId);
  }
  const row = await qGet<{ inf: string | number; outf: string | number }>(
    `SELECT
        COALESCE(SUM(CASE WHEN tc.amount > 0 THEN tc.amount ELSE 0 END), 0) AS inf,
        COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS outf
       FROM transaction_canonical tc
      WHERE tc.household_id = ?
        AND tc.status = 'posted'
        AND tc.transfer_group_id IS NULL
        AND tc.txn_date >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - interval '12 months', 'YYYY-MM-DD')
        ${userClause}`,
    ...params
  );
  return {
    inflow12: Number(row?.inf ?? 0),
    outflow12: Number(row?.outf ?? 0)
  };
}

async function topSpendCategories12m(
  householdId: string,
  userId: string | null
): Promise<Array<{ name: string; avgMonthlySpend: number }>> {
  const userClause = userId ? " AND tc.user_id = ? " : "";
  const params: unknown[] = [householdId];
  if (userId) {
    params.push(userId);
  }
  const rows = await qAll<{ cat_name: string; total_spend: string | number }>(
    `SELECT cat_name, total_spend FROM (
        SELECT
          CASE WHEN tc.category_id IS NULL THEN 'Uncategorized'
               ELSE COALESCE(p.name, c.name) END AS cat_name,
          COALESCE(SUM(CASE WHEN tc.amount < 0 THEN -tc.amount ELSE 0 END), 0) AS total_spend
        FROM transaction_canonical tc
        LEFT JOIN category c ON c.id = tc.category_id
        LEFT JOIN category p ON p.id = c.parent_id
       WHERE tc.household_id = ?
         AND tc.status = 'posted'
         AND tc.transfer_group_id IS NULL
         AND tc.txn_date >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - interval '12 months', 'YYYY-MM-DD')
         ${userClause}
       GROUP BY CASE WHEN tc.category_id IS NULL THEN 'Uncategorized'
                     ELSE COALESCE(p.name, c.name) END
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

  const budgetRows = await qAll<{ category_id: string; month: string; amount: string | number; cat_name: string }>(
    `SELECT bc.category_id, bc.month, bc.amount, COALESCE(p.name, c.name) AS cat_name
       FROM budget_category bc
       JOIN category c ON c.id = bc.category_id
       LEFT JOIN category p ON p.id = c.parent_id
      WHERE bc.household_id = ?
        AND bc.month IN (?, ?, ?)`,
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
    age: self?.age != null ? Number(self.age) : null,
    sex: self?.sex != null ? String(self.sex) : null
  };
  const spouseBlock =
    spouse != null
      ? {
          age: spouse.age != null ? Number(spouse.age) : null,
          sex: spouse.sex != null ? String(spouse.sex) : null
        }
      : null;

  const riskTolerance = self?.risk_tolerance != null ? String(self.risk_tolerance) : null;
  const financialGoals = self ? parseGoals(self.financial_goals_json) : [];

  const netWorth = await buildNetWorthBlock(householdId);
  const { inflow12, outflow12 } = await flowTotals12m(householdId, null);
  const avgMonthlyInflow = round2(inflow12 / 12);
  const avgMonthlyOutflow = round2(outflow12 / 12);
  const avgMonthlySavingsRate =
    inflow12 > 0 ? round2((inflow12 - outflow12) / inflow12) : 0;

  const topCategories = await topSpendCategories12m(householdId, null);
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
    avgMonthlyOutflow,
    avgMonthlySavingsRate,
    topCategories,
    confirmedRecurring,
    overBudgetCategories: overBudget
  };
}

export async function assemblePersonalPromptInput(householdId: string, userId: string): Promise<InsightPromptInput> {
  const demo = await loadHouseholdDemographics(householdId);
  const row = await qGet<{
    age: number | null;
    sex: string | null;
    risk_tolerance: string | null;
    financial_goals_json: string | null;
    individual_gross_income_usd: number | null;
  }>(
    `SELECT p.age, p.sex, p.risk_tolerance, p.financial_goals_json, p.individual_gross_income_usd
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
  const { inflow12, outflow12 } = await flowTotals12m(householdId, userId);
  const avgMonthlyInflow = round2(inflow12 / 12);
  const avgMonthlyOutflow = round2(outflow12 / 12);
  const avgMonthlySavingsRate =
    inflow12 > 0 ? round2((inflow12 - outflow12) / inflow12) : 0;

  const topCategories = await topSpendCategories12m(householdId, userId);
  const confirmedRecurring = await confirmedRecurringRows(householdId);
  const overBudget = await overBudgetCategories(householdId, userId);

  return {
    headOfHousehold: {
      age: row?.age != null ? Number(row.age) : null,
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
    avgMonthlyOutflow,
    avgMonthlySavingsRate,
    topCategories,
    confirmedRecurring,
    overBudgetCategories: overBudget
  };
}
