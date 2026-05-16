#!/usr/bin/env node
/**
 * Generates dev sample ledger rows for local manual testing (npm run db:seed:dev).
 * Deterministic pseudo-random merchants, amounts, and dates — stable across regenerations.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "backend/db/seeds/dev/dev_0004_seed_sample_ledger.sql");

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const OWNER_USER_ID = "20000000-0000-0000-0000-000000000001";
const OWNER_PROFILE_ID = "70000000-0000-0000-0000-000000000001";
const SPOUSE_PROFILE_ID = "70000000-0000-0000-0000-000000000002";
const CHECKING = "40000000-0000-0000-0000-000000000001";
const SAVINGS = "40000000-0000-0000-0000-000000000002";
const BOA_CC = "40000000-0000-0000-0000-000000000003";
const CITI_CC = "40000000-0000-0000-0000-000000000004";
const CHASE_CC = "40000000-0000-0000-0000-000000000005";
const MARCUS = "40000000-0000-0000-0000-000000000006";

const ACCOUNTS = [CHECKING, SAVINGS, BOA_CC, CITI_CC, CHASE_CC, MARCUS];

/** @type {Array<{ merchant: string; categoryId: string; credit?: boolean; accounts?: string[] }>} */
const TEMPLATES = [
  { merchant: "COSTCO WHOLESALE #123", categoryId: "30000000-0000-0000-0000-000000000004" },
  { merchant: "WHOLE FOODS MKT", categoryId: "30000000-0000-0000-0000-000000000004" },
  { merchant: "TRADER JOE'S #45", categoryId: "30000000-0000-0000-0000-000000000004" },
  { merchant: "TARGET T-2841", categoryId: "30000000-0000-0000-0000-000000000004" },
  { merchant: "WALMART SUPERCENTER", categoryId: "30000000-0000-0000-0000-000000000004" },
  { merchant: "STARBUCKS STORE 8821", categoryId: "30000000-0000-0000-0000-000000000024" },
  { merchant: "CHIPOTLE ONLINE", categoryId: "30000000-0000-0000-0000-000000000023" },
  { merchant: "DOORDASH*THAI KITCHEN", categoryId: "30000000-0000-0000-0000-000000000023" },
  { merchant: "NETFLIX.COM", categoryId: "30000000-0000-0000-0000-000000000160" },
  { merchant: "SPOTIFY USA", categoryId: "30000000-0000-0000-0000-000000000160" },
  { merchant: "SHELL OIL 57444", categoryId: "30000000-0000-0000-0000-000000000154" },
  { merchant: "CHEVRON 00912", categoryId: "30000000-0000-0000-0000-000000000154" },
  { merchant: "AMAZON MKTPLACE PMTS", categoryId: "30000000-0000-0000-0000-000000000148" },
  { merchant: "COMCAST / XFINITY", categoryId: "30000000-0000-0000-0000-000000000156" },
  { merchant: "PG&E WEB PAY", categoryId: "30000000-0000-0000-0000-000000000118" },
  { merchant: "CVS/PHARMACY #4412", categoryId: "30000000-0000-0000-0000-000000000125" },
  { merchant: "DELTA AIR LINES", categoryId: "30000000-0000-0000-0000-000000000143" },
  { merchant: "UNITED AIRLINES", categoryId: "30000000-0000-0000-0000-000000000143" },
  { merchant: "STATE FARM INSURANCE", categoryId: "30000000-0000-0000-0000-000000000026" },
  { merchant: "GEICO AUTO", categoryId: "30000000-0000-0000-0000-000000000026" },
  { merchant: "ACME CHILD CARE", categoryId: "30000000-0000-0000-0000-000000000028" },
  { merchant: "CITY WATER DEPT", categoryId: "30000000-0000-0000-0000-000000000119" },
  { merchant: "HOME DEPOT #1204", categoryId: "30000000-0000-0000-0000-000000000035" },
  { merchant: "LOWES #00931", categoryId: "30000000-0000-0000-0000-000000000035" },
  { merchant: "AMC THEATRES", categoryId: "30000000-0000-0000-0000-000000000161" },
  { merchant: "DIRECT DEPOSIT PAYROLL", categoryId: "30000000-0000-0000-0000-000000000007", credit: true, accounts: [CHECKING] },
  { merchant: "INTEREST PAID", categoryId: "30000000-0000-0000-0000-000000000011", credit: true, accounts: [SAVINGS, MARCUS] },
  { merchant: "AMAZON REFUND", categoryId: "30000000-0000-0000-0000-000000000013", credit: true },
  { merchant: "VENMO CASHOUT", categoryId: "30000000-0000-0000-0000-000000000151", credit: true, accounts: [CHECKING] }
];

const ROW_COUNT = 520;
const START = new Date(Date.UTC(2024, 1, 1));
const END = new Date(Date.UTC(2025, 11, 31));
const DAY_SPAN = Math.floor((END - START) / 86_400_000);

function hash32(seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16);
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function txnId(i) {
  return `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

function buildMembersSql() {
  return `-- Household member profiles for belongs-to / person-scoped ledger testing.
INSERT INTO person_profile (id, household_id, linked_user_id, full_name, email, created_at)
VALUES
  ('${OWNER_PROFILE_ID}', '${HOUSEHOLD_ID}', '${OWNER_USER_ID}', 'Alex Owner', 'owner@example.com', CURRENT_TIMESTAMP),
  ('${SPOUSE_PROFILE_ID}', '${HOUSEHOLD_ID}', NULL, 'Sam Spouse', 'spouse@example.com', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

INSERT INTO household_membership (id, household_id, person_profile_id, role, relationship, created_at)
VALUES
  ('80000000-0000-0000-0000-000000000001', '${HOUSEHOLD_ID}', '${OWNER_PROFILE_ID}', 'head', 'self', CURRENT_TIMESTAMP),
  ('80000000-0000-0000-0000-000000000002', '${HOUSEHOLD_ID}', '${SPOUSE_PROFILE_ID}', 'member', 'spouse', CURRENT_TIMESTAMP)
ON CONFLICT (household_id, person_profile_id) DO NOTHING;
`;
}

function buildLedgerSql() {
  const rows = [];
  for (let i = 1; i <= ROW_COUNT; i += 1) {
    const h = hash32(`dev-ledger-${i}`);
    const template = TEMPLATES[h % TEMPLATES.length];
    const credit = Boolean(template.credit);
    const accountPool = template.accounts ?? ACCOUNTS;
    const accountId = accountPool[h % accountPool.length];

    const dayOffset = h % (DAY_SPAN + 1);
    const txnDate = new Date(START);
    txnDate.setUTCDate(txnDate.getUTCDate() + dayOffset);

    const cents = 500 + (h % 49_500);
    const amount = credit ? roundMoney(cents / 100 + (h % 4_000)) : -roundMoney(cents / 100);
    const direction = amount >= 0 ? "credit" : "debit";

    const personScoped = !credit && h % 5 === 0;
    const ownerScope = personScoped ? "person" : "household";
    const ownerPersonProfileId = personScoped
      ? h % 2 === 0
        ? OWNER_PROFILE_ID
        : SPOUSE_PROFILE_ID
      : null;

    const merchant = `${template.merchant}${h % 17 === 0 ? ` ${(h % 90) + 10}` : ""}`;
    const memo = h % 11 === 0 ? `Dev sample memo #${i}` : null;
    const fingerprint = crypto.createHash("sha256").update(`dev-sample-ledger:${i}`).digest("hex");
    const sourceRef = `manual:dev-sample-${i}`;
    const classificationMeta = JSON.stringify({ source: "manual" });

    rows.push(
      `  (${sqlString(txnId(i))}, ${sqlString(HOUSEHOLD_ID)}, ${sqlString(accountId)}, NULL, ${sqlString(template.categoryId)}, ${sqlString(isoDate(txnDate))}, ${amount}, ${sqlString(direction)}, ${sqlString(merchant)}, ${memo ? sqlString(memo) : "NULL"}, ${sqlString(fingerprint)}, ${sqlString(sourceRef)}, 'posted', ${sqlString(classificationMeta)}, ${sqlString(ownerScope)}, ${ownerPersonProfileId ? sqlString(ownerPersonProfileId) : "NULL"})`
    );
  }

  return `-- ${ROW_COUNT} posted sample transactions for default household (local dev / integration smoke).
-- Regenerate: node scripts/generate-dev-ledger-seed.mjs
INSERT INTO transaction_canonical (
  id, household_id, account_id, user_id, category_id, txn_date, amount, direction,
  merchant, memo, fingerprint, source_ref, status, classification_meta, owner_scope, owner_person_profile_id
)
VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
}

const sql = `-- Dev sample ledger (generated ${new Date().toISOString().slice(0, 10)})
${buildMembersSql()}
${buildLedgerSql()}
`;

fs.writeFileSync(OUT, sql, "utf8");
console.log(`Wrote ${OUT} (${ROW_COUNT} transactions)`);
