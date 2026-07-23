// STALE since migration 0044_i3_rule_taxonomy_fix.sql: that migration hand-patched
// fuel/parking rules directly in 0001_bootstrap.sql (Shell/Exxon/Chevron/BP/parking/toll
// moved out of Mobility > Public Transit into their own categories) without updating this
// script's hardcoded row list below. Do NOT run this script to regenerate the bootstrap
// seed block without first diffing its output against the current seed — as of DEBT #258
// (2026-07-23) it would silently revert that taxonomy fix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function norm(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const incomeRefunds = "30000000-0000-0000-0000-000000000013";
const incomeRental = "30000000-0000-0000-0000-000000000010";
const incomeInterest = "30000000-0000-0000-0000-000000000011";
const incomeDividends = "30000000-0000-0000-0000-000000000012";
const incomeSalary = "30000000-0000-0000-0000-000000000007";
const housing = "30000000-0000-0000-0000-000000000002";
const utilitiesEnergy = "30000000-0000-0000-0000-000000000118";
const utilitiesWater = "30000000-0000-0000-0000-000000000119";
const utilitiesMobile = "30000000-0000-0000-0000-000000000120";
const diningOut = "30000000-0000-0000-0000-000000000023";
const coffee = "30000000-0000-0000-0000-000000000024";
const snacks = "30000000-0000-0000-0000-000000000124";
const groceries = "30000000-0000-0000-0000-000000000004";
const transitAndFuel = "30000000-0000-0000-0000-000000000005";
const autoMaintenance = "30000000-0000-0000-0000-000000000129";
const creditCardPayments = "30000000-0000-0000-0000-000000000006";
const loanPayments = "30000000-0000-0000-0000-000000000121";
const medical = "30000000-0000-0000-0000-000000000020";
const pharmacy = "30000000-0000-0000-0000-000000000021";
const fitness = "30000000-0000-0000-0000-000000000022";
const wellness = "30000000-0000-0000-0000-000000000125";
const federalIncomeTax = "30000000-0000-0000-0000-000000000113";
const stateIncomeTax = "30000000-0000-0000-0000-000000000130";
const salesTax = "30000000-0000-0000-0000-000000000114";
const federalTaxRefund = "30000000-0000-0000-0000-000000000131";
const stateTaxRefund = "30000000-0000-0000-0000-000000000132";

const rows = [];
let n = 1;
function uuid() {
  const hex = String(n++).padStart(12, "0");
  return "b0010000-0000-4000-8000-" + hex;
}
function add(ruleKey, pattern, cat, scope, pri) {
  const p = norm(pattern);
  if (p.length < 2) throw new Error("short: " + pattern);
  rows.push({ id: uuid(), ruleKey, pattern: p, cat, scope, pri });
}

["refund"].forEach((k) => add("income_refunds_" + norm(k).replace(/\s+/g, "_"), k, incomeRefunds, "credit_only", 100));
["rental income"].forEach((k) => add("income_rental_" + norm(k).replace(/\s+/g, "_"), k, incomeRental, "credit_only", 110));
["interest", "int pymt", "int payment"].forEach((k) =>
  add("income_interest_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, incomeInterest, "credit_only", 120)
);
["dividend"].forEach((k) => add("income_dividends_" + norm(k), k, incomeDividends, "credit_only", 130));
["payroll", "direct dep", "salary", "pay check", "paycheck", "commission"].forEach((k) =>
  add("income_salary_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, incomeSalary, "credit_only", 140)
);

["mortgage", " mtg", "rent ", " rent", "hoa", "landlord", "lease"].forEach((k, i) =>
  add("housing_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, housing, "debit_only", 200)
);

[
  "electric",
  "utilities",
  "utility",
  "internet",
  "gas bill",
  "duke energy",
  "comcast"
].forEach((k, i) => add("energy_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, utilitiesEnergy, "debit_only", 210));
["water bill", "sewer", "trash"].forEach((k, i) =>
  add("water_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, utilitiesWater, "debit_only", 211)
);
["verizon", "at&t", "att ", "t-mobile", "tmobile"].forEach((k, i) =>
  add("mobile_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, utilitiesMobile, "debit_only", 212)
);

[
  ["restaurant", "debit_only"],
  ["grubhub", "any"],
  ["doordash", "any"],
  ["uber eats", "any"],
  ["chipotle", "any"],
  ["taco bell", "any"],
  ["mcdonald", "any"],
  ["panera", "any"],
  ["panda express", "any"]
].forEach(([k, scope], i) =>
  add("dining_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, diningOut, scope, 220)
);
[
  ["starbucks", "any"],
  ["dunkin", "any"],
  ["dutch bro", "any"],
  ["coffee", "debit_only"]
].forEach(([k, scope], i) =>
  add("coffee_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, coffee, scope, 230)
);
["chips", "candy bar", "vending", "snack"].forEach((k, i) =>
  add("snacks_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, snacks, "debit_only", 231)
);
[
  ["whole foods", "any"],
  ["trader joe", "any"],
  ["kroger", "any"],
  ["safeway", "any"],
  ["aldi", "any"],
  ["grocery", "debit_only"],
  ["groceries", "debit_only"],
  ["walmart", "any"],
  ["costco", "any"],
  ["target", "any"],
  ["publix", "any"]
].forEach(([k, scope], i) =>
  add("groceries_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, groceries, scope, 240)
);
[
  ["uber", "any"],
  ["lyft", "any"],
  ["shell", "any"],
  ["exxon", "any"],
  ["chevron", "any"],
  ["bp ", "any"],
  ["parking", "any"],
  ["metro", "debit_only"],
  ["transit", "debit_only"],
  ["toll ", "any"]
].forEach(([k, scope], i) =>
  add("transit_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, transitAndFuel, scope, 250)
);
[
  "auto repair",
  "firestone",
  "pep boys",
  "autozone",
  "o'reilly",
  "dealership",
  "jiffy lube",
  "tire"
].forEach((k, i) => add("auto_maint_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, autoMaintenance, "debit_only", 251));
["card payment", "credit card"].forEach((k, i) =>
  add("cc_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, creditCardPayments, "debit_only", 260)
);
["loan pmt", "loan payment", "auto loan", "student loan", "lending club"].forEach((k, i) =>
  add("loan_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, loanPayments, "debit_only", 261)
);
["hospital", "physician", "doctor", "urgent care", "medical", "lab corp", "quest diag"].forEach((k, i) =>
  add("medical_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, medical, "debit_only", 270)
);
["cvs ", "cvs#", "walgreens", "pharmacy", "rite aid"].forEach((k, i) =>
  add("pharmacy_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, pharmacy, "debit_only", 280)
);
["gym", "planet fitness", "ymca", "crossfit"].forEach((k, i) =>
  add("fitness_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, fitness, "debit_only", 285)
);
["meditation", "headspace", "calm.com", "wellness spa"].forEach((k, i) =>
  add("wellness_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, wellness, "debit_only", 286)
);

["irs", "federal tax", "us treasury tax"].forEach((k, i) =>
  add("fed_tax_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, federalIncomeTax, "debit_only", 290)
);
["state tax", "franchise tax", "ftb"].forEach((k, i) =>
  add("state_tax_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, stateIncomeTax, "debit_only", 291)
);
["sales tax"].forEach((k, i) => add("sales_tax_" + i, k, salesTax, "debit_only", 292));
["irs treas", "federal refund", "tax refund irs"].forEach((k, i) =>
  add("fed_refund_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, federalTaxRefund, "credit_only", 293)
);
["state refund", "tax refund state"].forEach((k, i) =>
  add("state_refund_" + i + "_" + norm(k).replace(/[^a-z0-9]+/g, "_"), k, stateTaxRefund, "credit_only", 294)
);

const seen = new Set();
for (const r of rows) {
  let k = r.ruleKey;
  let i = 0;
  while (seen.has(k)) k = r.ruleKey + "_" + ++i;
  seen.add(k);
  r.ruleKey = k;
}

const patSeen = new Set();
const uniq = [];
for (const r of rows) {
  const key = r.pattern + "|" + r.cat + "|" + r.scope + "|" + r.pri;
  if (patSeen.has(key)) continue;
  patSeen.add(key);
  uniq.push(r);
}

const vals = uniq.map((r) => {
  const esc = r.pattern.replace(/'/g, "''");
  return `  ('${r.id}', NULL, '${r.ruleKey}', '${esc}', 'contains', '${r.cat}', '${r.scope}', 0.7, ${r.pri}, 1)`;
});
if (vals.length === 0) {
  throw new Error("No global category_rule rows to emit; check input list.");
}
const last = vals.length - 1;
const valuesSql = vals
  .map((line, i) => (i === last ? `${line} ON CONFLICT DO NOTHING` : line))
  .join(",\n");
const rulesBlock =
  `-- Built-in global category rules (generated by backend/scripts/gen-0026-migration.mjs).\n` +
  `-- Runs in same file after category inserts so category_id FKs resolve.\n\n` +
  `INSERT INTO category_rule\n` +
  `  (id, household_id, rule_key, pattern, match_type, category_id, amount_scope, confidence, priority, enabled)\n` +
  `VALUES\n` +
  `${valuesSql};\n`;

const bootPath = path.join(__dirname, "../db/seeds/0001_bootstrap.sql");
const boot = fs.readFileSync(bootPath, "utf8");
const rulesStart = boot.indexOf("-- Built-in global category rules");
if (rulesStart < 0) {
  throw new Error("Could not find global rules section marker in 0001_bootstrap.sql");
}
const head = boot.slice(0, rulesStart).trimEnd();
const footerMarker = "\n\n-- Former 0003";
const footerIdx = boot.indexOf(footerMarker);
const footer =
  footerIdx >= 0
    ? boot.slice(footerIdx)
    : "\n\n-- Former 0003_seed_default_household_categories.sql (Option B): reserved for household-scoped install defaults; currently unused.\n";

fs.writeFileSync(bootPath, `${head}\n${rulesBlock.trimEnd()}${footer}`, "utf8");
console.log("Updated global category_rule inserts in", bootPath, "rows", uniq.length);
