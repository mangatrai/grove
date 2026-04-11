/**
 * OFX / QFX / QBO parser (CR-071).
 *
 * OFX 1.x  — SGML-like with unclosed leaf tags (OFXHEADER:100 style).
 * OFX 2.x  — proper XML (starts with <?xml or <?OFX).
 * QFX      — OFX 1.x + Quicken-proprietary header; same parser handles it.
 * QBO      — OFX 2.x + QuickBooks header; same parser handles it.
 *
 * We use a single cheerio-based pass for OFX 2.x and a lightweight
 * regex scanner for OFX 1.x.  Cheerio is already a project dependency.
 */

import * as cheerio from "cheerio";

import type { NormalizedRawPayload } from "./types.js";

export interface OfxAccountInfo {
  /** Raw account id from the OFX file, e.g. "00001234567890". */
  acctId: string | null;
  /** OFX account type: CHECKING | SAVINGS | CREDITLINE | MONEYMRKT | CD etc. */
  acctType: string | null;
  /** Routing / bank id. */
  bankId: string | null;
  /** FI > ORG name, e.g. "Bank of America". */
  institution: string | null;
  /** Currency code, e.g. "USD". */
  currency: string | null;
}

export interface OfxParseResult {
  rows: NormalizedRawPayload[];
  accountInfo: OfxAccountInfo;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert OFX date YYYYMMDDHHMMSS[tz] → ISO YYYY-MM-DD. */
function ofxDateToIso(raw: string): string | null {
  const digits = raw.trim().replace(/\[.*\]$/, "").trim();
  if (digits.length < 8) {
    return null;
  }
  const y = digits.slice(0, 4);
  const mo = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(mo) || !/^\d{2}$/.test(d)) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/**
 * Extract the text value of a leaf OFX 1.x element.
 * Pattern: <TAGNAME>value  (value ends before next `<`, CR, or LF)
 */
function extractLeaf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\r\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1]!.trim() : null;
}

function buildDescription(name: string | null, memo: string | null): string {
  const parts = [name, memo].filter((s): s is string => Boolean(s?.trim()));
  return parts.join(" — ") || "OFX Transaction";
}

function isOfx2(content: string): boolean {
  const head = content.trimStart().slice(0, 20).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<?ofx");
}

// ---------------------------------------------------------------------------
// OFX 1.x parser (SGML-like)
// ---------------------------------------------------------------------------

/**
 * Detect account type from the OFX container element name.
 * Credit card accounts use <CCACCTFROM>; bank accounts use <BANKACCTFROM> with an explicit <ACCTTYPE>.
 */
function containerToAcctType(containerTag: string, explicit: string | null): string | null {
  if (explicit) {
    return explicit;
  }
  if (/CCACCT/i.test(containerTag)) {
    return "credit_card";
  }
  return null;
}

/** Normalise an OFX institution ORG field.  Short vendor/internal codes (e.g. "B1", "10898") are suppressed. */
function normalizeOrg(org: string | null): string | null {
  if (!org) {
    return null;
  }
  const t = org.trim();
  // Pure numeric FIDs, or very short opaque codes, are not human-readable institution names.
  if (/^\d+$/.test(t) || t.length <= 3) {
    return null;
  }
  return t;
}

function parseOfx1(content: string): OfxParseResult {
  // Normalise line endings
  const body = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // ---- Account info -------------------------------------------------------
  const acctFromRe = /<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/(?:BANKACCTFROM|CCACCTFROM)>/i;
  const acctFromMatch = body.match(acctFromRe);
  const containerTag = acctFromMatch?.[1] ?? "";
  const acctBlock = acctFromMatch?.[2] ?? body;

  const acctId = extractLeaf(acctBlock, "ACCTID");
  const explicitAcctType = extractLeaf(acctBlock, "ACCTTYPE");
  const acctType = containerToAcctType(containerTag, explicitAcctType);
  const bankId = extractLeaf(acctBlock, "BANKID");
  const currency = extractLeaf(body, "CURDEF");

  const fiMatch = body.match(/<FI>([\s\S]*?)<\/FI>/i);
  const institution = fiMatch ? normalizeOrg(extractLeaf(fiMatch[1]!, "ORG")) : null;

  // ---- Transactions --------------------------------------------------------
  const rows: NormalizedRawPayload[] = [];
  const txnRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;

  while ((m = txnRe.exec(body)) !== null) {
    const blk = m[1]!;
    const fitid = extractLeaf(blk, "FITID");
    const dtPosted = extractLeaf(blk, "DTPOSTED") ?? extractLeaf(blk, "DTUSER");
    const amtStr = extractLeaf(blk, "TRNAMT");
    const name = extractLeaf(blk, "NAME");
    const memo = extractLeaf(blk, "MEMO");

    if (!dtPosted || !amtStr) {
      continue;
    }
    const isoDate = ofxDateToIso(dtPosted);
    if (!isoDate) {
      continue;
    }
    const amount = parseFloat(amtStr);
    if (!Number.isFinite(amount)) {
      continue;
    }

    rows.push({
      txn_date: isoDate,
      posting_date: isoDate,
      description: buildDescription(name, memo),
      amount,
      reference_id: fitid ?? undefined,
      source_row: {
        FITID: fitid ?? "",
        DTPOSTED: dtPosted,
        TRNAMT: amtStr,
        NAME: name ?? "",
        MEMO: memo ?? ""
      }
    });
  }

  return {
    rows,
    accountInfo: { acctId, acctType, bankId, institution, currency }
  };
}

// ---------------------------------------------------------------------------
// OFX 2.x parser (XML via cheerio)
// ---------------------------------------------------------------------------

function parseOfx2(content: string): OfxParseResult {
  const $ = cheerio.load(content, { xmlMode: true });

  const ccAcctFrom = $("ccacctfrom").first();
  const bankAcctFrom = $("bankacctfrom").first();
  const isCreditCard = ccAcctFrom.length > 0;
  const acctFrom = isCreditCard ? ccAcctFrom : bankAcctFrom;

  const acctId = acctFrom.find("acctid").first().text().trim() || null;
  const explicitAcctType = acctFrom.find("accttype").first().text().trim() || null;
  const acctType = isCreditCard ? "credit_card" : (explicitAcctType || null);
  const bankId = acctFrom.find("bankid").first().text().trim() || null;
  const currency = $("curdef").first().text().trim() || null;
  const institution = normalizeOrg($("fi org").first().text().trim() || null);

  const rows: NormalizedRawPayload[] = [];

  $("stmttrn").each((_, el) => {
    const blk = $(el);
    const fitid = blk.find("fitid").first().text().trim();
    const dtPosted = blk.find("dtposted").first().text().trim() || blk.find("dtuser").first().text().trim();
    const amtStr = blk.find("trnamt").first().text().trim();
    const name = blk.find("name").first().text().trim();
    const memo = blk.find("memo").first().text().trim();

    if (!dtPosted || !amtStr) {
      return;
    }
    const isoDate = ofxDateToIso(dtPosted);
    if (!isoDate) {
      return;
    }
    const amount = parseFloat(amtStr);
    if (!Number.isFinite(amount)) {
      return;
    }

    rows.push({
      txn_date: isoDate,
      posting_date: isoDate,
      description: buildDescription(name || null, memo || null),
      amount,
      reference_id: fitid || undefined,
      source_row: {
        FITID: fitid,
        DTPOSTED: dtPosted,
        TRNAMT: amtStr,
        NAME: name,
        MEMO: memo
      }
    });
  });

  return {
    rows,
    accountInfo: {
      acctId: acctId || null,
      acctType: acctType || null,
      bankId: bankId || null,
      institution: institution || null,
      currency: currency || null
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OFX / QFX / QBO file buffer.
 * Returns parsed transaction rows and account metadata from the statement header.
 */
export function parseOfxBuffer(buffer: Buffer): OfxParseResult {
  const content = buffer.toString("utf-8");
  return isOfx2(content) ? parseOfx2(content) : parseOfx1(content);
}

/** Extract only account info from an OFX/QFX/QBO buffer (for upload-time pre-flight). */
export function extractOfxAccountInfo(buffer: Buffer): OfxAccountInfo {
  return parseOfxBuffer(buffer).accountInfo;
}
