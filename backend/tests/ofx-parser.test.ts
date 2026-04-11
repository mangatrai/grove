/**
 * Unit tests for the OFX / QFX / QBO parser (CR-071).
 * Uses inline fixture strings — no real user files.
 */

import { describe, expect, it } from "vitest";

import { parseOfxBuffer, extractOfxAccountInfo } from "../src/modules/imports/profiles/ofx-parser.js";

// ---------------------------------------------------------------------------
// Minimal OFX 1.x (SGML-like) fixture — mirrors Chase QFX structure
// ---------------------------------------------------------------------------
const OFX1_CREDIT_CARD = `
OFXHEADER:100
DATA:OFXSGML
VERSION:151
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260411120000</DTSERVER><LANGUAGE>ENG</LANGUAGE><FI><ORG>B1</ORG><FID>10898</FID></FI></SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1001</TRNUID>
<CCSTMTRS>
<CURDEF>USD</CURDEF>
<CCACCTFROM>
<ACCTID>1114758420-4883</ACCTID>
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20250101</DTSTART>
<DTEND>20260411</DTEND>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260101120000</DTPOSTED>
<TRNAMT>-45.67</TRNAMT>
<FITID>2026010100001</FITID>
<NAME>WHOLE FOODS MARKET</NAME>
<MEMO>Grocery</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260103</DTPOSTED>
<TRNAMT>-12.00</TRNAMT>
<FITID>2026010300001</FITID>
<NAME>NETFLIX.COM</NAME>
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260105</DTPOSTED>
<TRNAMT>500.00</TRNAMT>
<FITID>2026010500001</FITID>
<NAME>PAYMENT THANK YOU</NAME>
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
`;

// ---------------------------------------------------------------------------
// Minimal OFX 1.x bank (checking) fixture
// ---------------------------------------------------------------------------
const OFX1_CHECKING = `
OFXHEADER:100
DATA:OFXSGML

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD</CURDEF>
<BANKACCTFROM>
<BANKID>021000021</BANKID>
<ACCTID>000012345678</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260210</DTPOSTED>
<TRNAMT>-100.00</TRNAMT>
<FITID>FIT001</FITID>
<NAME>ACH PAYMENT</NAME>
<MEMO>Rent</MEMO>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

// ---------------------------------------------------------------------------
// Minimal OFX 2.x (XML) fixture
// ---------------------------------------------------------------------------
const OFX2_CHECKING = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <DTSERVER>20260411</DTSERVER>
      <LANGUAGE>ENG</LANGUAGE>
      <FI><ORG>Bank of America</ORG><FID>9999</FID></FI>
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>USD</CURDEF>
        <BANKACCTFROM>
          <BANKID>026009593</BANKID>
          <ACCTID>9876</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260301</DTPOSTED>
            <TRNAMT>-250.00</TRNAMT>
            <FITID>XML001</FITID>
            <NAME>ELECTRIC BILL</NAME>
            <MEMO>March utility</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260315</DTPOSTED>
            <TRNAMT>3500.00</TRNAMT>
            <FITID>XML002</FITID>
            <NAME>DIRECT DEPOSIT</NAME>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OFX 1.x credit card parser (Chase QFX style)", () => {
  const buf = Buffer.from(OFX1_CREDIT_CARD, "utf-8");

  it("parses all 3 transactions", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows).toHaveLength(3);
  });

  it("maps FITID to reference_id", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.reference_id).toBe("2026010100001");
  });

  it("converts DTPOSTED to ISO date", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.txn_date).toBe("2026-01-01");
    expect(rows[1]!.txn_date).toBe("2026-01-03");
  });

  it("preserves signed TRNAMT", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.amount).toBe(-45.67);
    expect(rows[2]!.amount).toBe(500.0);
  });

  it("joins NAME and MEMO with em-dash separator", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.description).toBe("WHOLE FOODS MARKET — Grocery");
  });

  it("uses NAME alone when MEMO is absent", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[1]!.description).toBe("NETFLIX.COM");
  });

  it("detects credit_card account type from CCACCTFROM container", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.acctType).toBe("credit_card");
  });

  it("extracts ACCTID correctly", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.acctId).toBe("1114758420-4883");
  });

  it("suppresses short/numeric ORG codes (B1, 10898)", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.institution).toBeNull();
  });

  it("extractOfxAccountInfo returns same accountInfo without parsing rows", () => {
    const info = extractOfxAccountInfo(buf);
    expect(info.acctId).toBe("1114758420-4883");
    expect(info.acctType).toBe("credit_card");
  });
});

describe("OFX 1.x checking parser", () => {
  const buf = Buffer.from(OFX1_CHECKING, "utf-8");

  it("parses 1 transaction", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows).toHaveLength(1);
  });

  it("detects checking account type from ACCTTYPE (raw OFX value)", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    // Parser stores raw OFX text; normalizeOfxAcctType (in ofx-account-match.service) lowercases it.
    expect(accountInfo.acctType).toBe("CHECKING");
  });

  it("extracts BANKID", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.bankId).toBe("021000021");
  });
});

describe("OFX 2.x XML parser", () => {
  const buf = Buffer.from(OFX2_CHECKING, "utf-8");

  it("parses 2 transactions", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows).toHaveLength(2);
  });

  it("converts XML DTPOSTED to ISO date", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.txn_date).toBe("2026-03-01");
  });

  it("maps FITID to reference_id in XML mode", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.reference_id).toBe("XML001");
  });

  it("extracts institution from FI/ORG when readable", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.institution).toBe("Bank of America");
  });

  it("detects checking type from ACCTTYPE in XML (raw OFX value)", () => {
    const { accountInfo } = parseOfxBuffer(buf);
    expect(accountInfo.acctType).toBe("CHECKING");
  });

  it("joins NAME and MEMO with em-dash in XML", () => {
    const { rows } = parseOfxBuffer(buf);
    expect(rows[0]!.description).toBe("ELECTRIC BILL — March utility");
  });
});
