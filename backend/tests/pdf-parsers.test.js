import { describe, expect, it } from "vitest";
import { parseBoaEStatementFromText } from "../src/modules/imports/profiles/boa-estatement-pdf.js";
import { parseMarcusOnlineSavingsFromText } from "../src/modules/imports/profiles/marcus-online-savings-pdf.js";
describe("BoA eStatement PDF text parser", () => {
    it("extracts deposits, ATM, and other subtractions", () => {
        const snippet = `
Deposits and other additions
Date \tDescription \tAmount
02/27/26 \tWealthfront \tDES:EDI PYMNTS
120,000.00
03/19/26 \tInterest Earned \t0.39
Total deposits and other additions \t$181,545.97

ATM and debit card subtractions
Date \tDescription \tAmount
03/02/26 \tCHECKCARD 0228 TMOBILE \t-205.09
Total ATM and debit card subtractions \t-$205.09

Other subtractions
Date \tDescription \tAmount
03/02/26 \tGOLDMAN SACHS BA DES:TRANSFER \t-110,000.00
Total other subtractions \t-$179,712.15
`;
        const rows = parseBoaEStatementFromText(snippet);
        expect(rows.length).toBe(4);
        expect(rows[0].amount).toBe(120000);
        expect(rows[0].description).toContain("Wealthfront");
        expect(rows[1].amount).toBe(0.39);
        expect(rows[2].amount).toBe(-205.09);
        expect(rows[3].amount).toBe(-110000);
    });
});
describe("Marcus online savings PDF text parser", () => {
    it("parses ACCOUNT ACTIVITY rows with debits and interest", () => {
        const snippet = `
ACCOUNT ACTIVITY
Date \tDescription \tCredits \tDebits \tBalance
02/01/2026 \tBeginning Balance \t$6,253.16
02/02/2026 \tACH Withdrawal PENNYMAC CASH \t$465.23 \t$5,787.93
02/28/2026 \tInterest Paid \t$11.49 \t$4,077.55
Streamline your savings growth
`;
        const rows = parseMarcusOnlineSavingsFromText(snippet);
        expect(rows.length).toBe(2);
        expect(rows[0].amount).toBe(-465.23);
        expect(rows[1].amount).toBe(11.49);
    });
});
