import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDeloittePayslipFromUnstructuredElements } from "../src/modules/payslip/profiles/deloitte-unstructured-parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Snippet from real Unstructured `Table.text`: summary `Net Pay` appears before totals line `NET PAY $…`. */
const PLAIN_TABLE_TEXT_WITH_AMBIGUOUS_NET_PAY = readFileSync(
  path.join(__dirname, "fixtures", "unstructured-deloitte-pay-statement.json"),
  "utf8"
);
const PLAIN_ONLY_ELEMENTS = JSON.parse(PLAIN_TABLE_TEXT_WITH_AMBIGUOUS_NET_PAY) as Record<string, unknown>[];
const TABLE_TEXT_DUP_NET = String(
  (PLAIN_ONLY_ELEMENTS.find((e) => e.type === "Table") as { text?: string })?.text ?? ""
);

describe("parseDeloittePayslipFromUnstructuredElements", () => {
  it("parses totals from Unstructured fixture (HTML-first, image_base64 stripped)", () => {
    const raw = readFileSync(path.join(__dirname, "fixtures", "unstructured-deloitte-pay-statement.json"), "utf8");
    const elements = JSON.parse(raw) as unknown[];
    const parsed = parseDeloittePayslipFromUnstructuredElements(elements);
    expect(parsed).not.toBeNull();
    expect(parsed!.grossPayCurrent).toBe(8430.18);
    expect(parsed!.grossPayYtd).toBe(24579.82);
    expect(parsed!.netPayCurrent).toBe(4370.18);
    expect(parsed!.netPayYtd).toBe(13173.41);
    expect(parsed!.payPeriodStart).toBe("2026-01-25");
    expect(parsed!.payPeriodEnd).toBe("2026-02-07");
    expect(parsed!.payDate).toBe("2026-02-06");
    expect(parsed!.preTaxDeductionsCurrent).toBe(2007.11);
    expect(parsed!.employeeTaxesCurrent).toBe(1785.76);
    expect(parsed!.postTaxDeductionsCurrent).toBe(267.13);
    expect((parsed!.rawExtractJson as { usedTextAsHtml?: boolean }).usedTextAsHtml).toBe(true);
  });

  it("falls back to plain Table.text when text_as_html is absent", () => {
    const elements = [
      {
        type: "Table",
        text:
          "TOTAL GROSS $8,430.18 $24,579.82 ... NET PAY $4,370.18 $13,173.41",
        metadata: {}
      }
    ];
    const parsed = parseDeloittePayslipFromUnstructuredElements(elements);
    expect(parsed).not.toBeNull();
    expect(parsed!.grossPayCurrent).toBe(8430.18);
    expect(parsed!.netPayCurrent).toBe(4370.18);
  });

  it("plain Table.text uses last NET PAY when summary strip contains an earlier Net Pay column", () => {
    const elements = [
      {
        type: "Table",
        text: TABLE_TEXT_DUP_NET,
        metadata: {}
      }
    ];
    const parsed = parseDeloittePayslipFromUnstructuredElements(elements);
    expect(parsed).not.toBeNull();
    expect(parsed!.grossPayCurrent).toBe(8430.18);
    expect(parsed!.grossPayYtd).toBe(24579.82);
    expect(parsed!.netPayCurrent).toBe(4370.18);
    expect(parsed!.netPayYtd).toBe(13173.41);
    expect(parsed!.preTaxDeductionsCurrent).toBe(2007.11);
    expect((parsed!.rawExtractJson as { usedTextAsHtml?: boolean }).usedTextAsHtml).toBe(false);
  });
});
