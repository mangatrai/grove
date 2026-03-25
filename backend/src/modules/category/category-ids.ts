/**
 * Default taxonomy from `backend/db/seeds/0001_seed_defaults.sql` (household_id NULL).
 * Stable ids for rule engine and tests.
 */
export const DEFAULT_CATEGORY_IDS = {
  // Top-level parents (roll-up only)
  income: "30000000-0000-0000-0000-000000000001",
  taxes: "30000000-0000-0000-0000-000000000111",
  transfers: "30000000-0000-0000-0000-000000000112",
  housing: "30000000-0000-0000-0000-000000000002",
  utilities: "30000000-0000-0000-0000-000000000003",
  groceries: "30000000-0000-0000-0000-000000000004",
  transport: "30000000-0000-0000-0000-000000000005",
  debtPayments: "30000000-0000-0000-0000-000000000006",

  // Income leaves (Epic 5.3 hierarchy + taxonomy expansions, migration 0008)
  incomeSalary: "30000000-0000-0000-0000-000000000007",
  incomeInterest: "30000000-0000-0000-0000-000000000011",
  incomeDividends: "30000000-0000-0000-0000-000000000012",
  incomeRentalIncome: "30000000-0000-0000-0000-000000000010",
  incomeRefunds: "30000000-0000-0000-0000-000000000013",

  medical: "30000000-0000-0000-0000-000000000020",
  pharmacy: "30000000-0000-0000-0000-000000000021",
  diningOut: "30000000-0000-0000-0000-000000000023",
  coffeeSnacks: "30000000-0000-0000-0000-000000000024",

  // Taxes leaves (added in migration 0008)
  taxPayments: "30000000-0000-0000-0000-000000000113",
  salesTax: "30000000-0000-0000-0000-000000000114",

  // Transfers leaves (added in migration 0008)
  transfersIn: "30000000-0000-0000-0000-000000000115",
  transfersOut: "30000000-0000-0000-0000-000000000116"
} as const;
