import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { qAll, qExec, qGet } from "../src/db/query.js";

// FIX #215: mock the IMAP transport (imapflow) and MIME parser (mailparser) so the service is
// unit-tested without a real mailbox, and mock the LLM chat-adapter layer the same way
// family-agent.test.ts does — distinguishable from getToolUseAdapter so tests can assert the
// extraction call is tool-less (prompt-injection hardening requirement from GH #215).
type CompleteFn = (
  messages: unknown,
  options: { model: string; maxTokens: number }
) => Promise<{ content: string; usage: Record<string, never> }>;

const { mockComplete, mockRunToolLoop, mockImapSearch, mockImapFetchMessages, mockSimpleParser } = vi.hoisted(() => ({
  mockComplete: vi.fn<CompleteFn>(),
  mockRunToolLoop: vi.fn(),
  mockImapSearch: vi.fn(),
  mockImapFetchMessages: vi.fn(),
  mockSimpleParser: vi.fn()
}));

vi.mock("../src/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/index.js")>();
  return {
    ...actual,
    chatModel: () => "TEST_CHEAP_MODEL",
    getChatAdapter: () => ({ complete: mockComplete }),
    getToolUseAdapter: () => ({ runToolLoop: mockRunToolLoop })
  };
});

vi.mock("imapflow", () => {
  class FakeImapFlow {
    async connect() {
      return undefined;
    }
    async getMailboxLock() {
      return { release: () => undefined };
    }
    async search(...args: unknown[]) {
      return mockImapSearch(...args);
    }
    async *fetch(...args: unknown[]) {
      const msgs = mockImapFetchMessages(...args) as { uid: number; source: Buffer }[];
      for (const m of msgs) yield m;
    }
    async logout() {
      return undefined;
    }
  }
  return { ImapFlow: FakeImapFlow };
});

vi.mock("mailparser", () => ({
  simpleParser: (...args: unknown[]) => mockSimpleParser(...args)
}));

const { pollHouseholdInboxForAllHouseholds } = await import("../src/modules/family/email-ingest.service.js");

const HOUSEHOLD_ID = "99990000-test-0000-0000-emailhousehold1";
// The dev-seed "Default Household" also exists in the test DB (seeded by `--dev-seeds` before
// every test run) and is therefore also processed by pollHouseholdInboxForAllHouseholds() — it
// iterates every household row, matching the codebase's other cross-household poller pattern.
// Tests assert on HOUSEHOLD_ID-scoped rows only, and clean up anything the poll wrote to the
// seed household too, so this file leaves no residue for other test files.
const DEFAULT_HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";

function fakeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    messageId: "<msg-1@school.example>",
    from: { text: "front-office@school.example" },
    subject: "This week at Example Elementary",
    date: new Date("2026-07-01T12:00:00Z"),
    text: "Reminder: the field trip permission form is due this Friday, July 10.",
    ...overrides
  };
}

function primeOneMessage(overrides: Partial<Record<string, unknown>> = {}) {
  mockImapSearch.mockResolvedValue([1]);
  mockImapFetchMessages.mockReturnValue([{ uid: 1, source: Buffer.from("raw-mime-does-not-matter") }]);
  mockSimpleParser.mockResolvedValue(fakeMessage(overrides));
}

function extractionResponse(items: unknown[]) {
  return { content: JSON.stringify({ items }), usage: {} };
}

describe("FIX #215 — household inbox email ingestion", () => {
  beforeAll(async () => {
    await qExec(
      `INSERT INTO household (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      HOUSEHOLD_ID, "FIX-215 Test Household"
    );
  });

  afterAll(async () => {
    await qExec(`DELETE FROM family_agent_alerts WHERE household_id = ?`, HOUSEHOLD_ID);
    await qExec(`DELETE FROM family_events WHERE household_id = ?`, HOUSEHOLD_ID);
    await qExec(`DELETE FROM email_ingest_log WHERE household_id = ?`, HOUSEHOLD_ID);
    await qExec(`DELETE FROM household WHERE id = ?`, HOUSEHOLD_ID);
  });

  beforeEach(() => {
    mockComplete.mockReset();
    mockRunToolLoop.mockReset();
    mockImapSearch.mockReset();
    mockImapFetchMessages.mockReset();
    mockSimpleParser.mockReset();
  });

  afterEach(async () => {
    await qExec(`DELETE FROM family_events WHERE household_id = ?`, HOUSEHOLD_ID);
    for (const hid of [HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_ID]) {
      // Scoped to '[EMAIL]%' so the Default Household's own seeded alerts (if any) are untouched.
      await qExec(`DELETE FROM family_agent_alerts WHERE household_id = ? AND reason LIKE '[EMAIL]%'`, hid);
      await qExec(`DELETE FROM email_ingest_log WHERE household_id = ?`, hid);
    }
  });

  it("creates a pending suggestion alert with source_quote and a calendar action payload", async () => {
    primeOneMessage();
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "deadline",
          title: "Field trip permission form due",
          date: "2026-07-10",
          time: null,
          who: null,
          actionRequired: "Sign and return the field trip permission form.",
          sourceQuote: "the field trip permission form is due this Friday, July 10."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const logRow = await qGet<{ status: string; message_id: string }>(
      `SELECT status, message_id FROM email_ingest_log WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(logRow?.status).toBe("processed");
    expect(logRow?.message_id).toBe("<msg-1@school.example>");

    const alert = await qGet<{
      reason: string;
      alert_type: string;
      source_quote: string | null;
      action_type: string | null;
      action_payload: { title: string; date: string; description: string } | null;
      is_resolved: boolean;
    }>(
      `SELECT reason, alert_type, source_quote, action_type, action_payload, is_resolved FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alert?.alert_type).toBe("suggestion");
    expect(alert?.reason).toContain("[EMAIL]");
    expect(alert?.reason).toContain("Field trip permission form due");
    expect(alert?.source_quote).toContain("July 10");
    expect(alert?.action_type).toBe("create_gcal_event");
    expect(alert?.action_payload?.date).toBe("2026-07-10");
    expect(alert?.is_resolved).toBe(false);

    // Prompt-injection hardening: extraction must go through the tool-less chat adapter only.
    expect(mockComplete).toHaveBeenCalled();
    expect(mockRunToolLoop).not.toHaveBeenCalled();
  });

  it("ignores a promotional email with no actionable items (empty items array)", async () => {
    primeOneMessage({ messageId: "<msg-promo@school.example>", text: "Buy yearbooks now — order by August!" });
    mockComplete.mockResolvedValue(extractionResponse([]));

    await pollHouseholdInboxForAllHouseholds();

    const logRow = await qGet<{ status: string }>(
      `SELECT status FROM email_ingest_log WHERE household_id = ? AND message_id = ?`,
      HOUSEHOLD_ID, "<msg-promo@school.example>"
    );
    expect(logRow?.status).toBe("ignored");

    const alerts = await qAll(`SELECT id FROM family_agent_alerts WHERE household_id = ?`, HOUSEHOLD_ID);
    expect(alerts.length).toBe(0);
  });

  it("dedups on message_id: a second poll of the same message does not create a second alert", async () => {
    primeOneMessage({ messageId: "<msg-dup@school.example>" });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "event",
          title: "Picture day",
          date: "2026-07-15",
          time: null,
          who: null,
          actionRequired: "Send in the picture day order form.",
          sourceQuote: "Picture day is scheduled for July 15."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();
    await pollHouseholdInboxForAllHouseholds();

    const logRows = await qAll(
      `SELECT id FROM email_ingest_log WHERE household_id = ? AND message_id = ?`,
      HOUSEHOLD_ID, "<msg-dup@school.example>"
    );
    expect(logRows.length).toBe(1);

    const alerts = await qAll(`SELECT id FROM family_agent_alerts WHERE household_id = ?`, HOUSEHOLD_ID);
    expect(alerts.length).toBe(1);
  });

  it("skips creating a suggestion when an active family_events row already covers the same title+date", async () => {
    await qExec(
      `INSERT INTO family_events (household_id, record_type, source, title, due_date, is_active)
       VALUES (?, 'deadline', 'manual', ?, ?, TRUE)`,
      HOUSEHOLD_ID, "Book fair form due", "2026-07-20"
    );
    primeOneMessage({ messageId: "<msg-existing@school.example>" });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "deadline",
          title: "Book fair form due",
          date: "2026-07-20",
          time: null,
          who: null,
          actionRequired: "Return the book fair order form.",
          sourceQuote: "Book fair forms are due July 20."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alerts = await qAll(`SELECT id FROM family_agent_alerts WHERE household_id = ?`, HOUSEHOLD_ID);
    expect(alerts.length).toBe(0);

    // The message itself is still logged (so it won't be re-fetched/re-extracted next poll).
    const logRow = await qGet<{ status: string }>(
      `SELECT status FROM email_ingest_log WHERE household_id = ? AND message_id = ?`,
      HOUSEHOLD_ID, "<msg-existing@school.example>"
    );
    expect(logRow?.status).toBe("processed");
  });

  // CR-224: extraction contract broadened beyond school/activity to order/delivery, financial
  // notice, appointment/medical, invitation/social, and utility/service/government genres.
  it("extracts an order/delivery item as calendar-actionable", async () => {
    primeOneMessage({
      messageId: "<msg-delivery@shop.example>",
      from: { text: "orders@acmeshop.example" },
      subject: "Your Acme Corp order has shipped",
      text: "Your package is arriving Thursday, July 16. Returns accepted through July 30."
    });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "delivery",
          title: "Acme Corp package arriving",
          date: "2026-07-16",
          time: null,
          who: null,
          actionRequired: "Be available to receive the package or arrange pickup.",
          sourceQuote: "Your package is arriving Thursday, July 16."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alert = await qGet<{ action_type: string | null; reason: string }>(
      `SELECT action_type, reason FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alert?.reason).toContain("[EMAIL]");
    expect(alert?.action_type).toBe("create_gcal_event");
  });

  it("extracts a financial-notice payment_due item as calendar-actionable", async () => {
    primeOneMessage({
      messageId: "<msg-payment@examplebank.example>",
      from: { text: "statements@examplebank.example" },
      subject: "Your card payment is due soon",
      text: "Your Example Bank card payment of $150.00 is due July 12. Account ending 4321."
    });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "payment_due",
          title: "Example Bank card payment due",
          date: "2026-07-12",
          time: null,
          who: null,
          actionRequired: "Pay the card balance before the due date.",
          sourceQuote: "Your Example Bank card payment of $150.00 is due July 12."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alert = await qGet<{ action_type: string | null }>(
      `SELECT action_type FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alert?.action_type).toBe("create_gcal_event");
  });

  it("keeps a financial-notice fraud alert as info with no calendar action even when dated, and tags urgency", async () => {
    primeOneMessage({
      messageId: "<msg-fraud@examplebank.example>",
      from: { text: "alerts@examplebank.example" },
      subject: "Unusual activity on your card",
      text: "We noticed unusual activity on your card ending 9876 on July 5. Review your recent transactions."
    });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "info",
          title: "Unusual card activity flagged",
          date: "2026-07-05",
          time: null,
          who: null,
          actionRequired: "Review recent card transactions for anything unrecognized.",
          sourceQuote: "We noticed unusual activity on your card ending 9876 on July 5.",
          urgency: "high"
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alert = await qGet<{ action_type: string | null; reason: string }>(
      `SELECT action_type, reason FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alert?.action_type).toBeNull();
    expect(alert?.reason).toContain("[EMAIL] [URGENT]");
  });

  it("extracts an appointment/medical item as calendar-actionable with a time", async () => {
    primeOneMessage({
      messageId: "<msg-appt@clinic.example>",
      from: { text: "scheduling@exampleclinic.example" },
      subject: "Appointment confirmation",
      text: "Your appointment is confirmed for July 14 at 3:00 PM. Please arrive 15 minutes early."
    });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "appointment",
          title: "Clinic appointment",
          date: "2026-07-14",
          time: "15:00",
          who: null,
          actionRequired: "Arrive 15 minutes early for the appointment.",
          sourceQuote: "Your appointment is confirmed for July 14 at 3:00 PM."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alert = await qGet<{ action_type: string | null; action_payload: { time?: string } | null }>(
      `SELECT action_type, action_payload FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alert?.action_type).toBe("create_gcal_event");
    expect(alert?.action_payload?.time).toBe("15:00");
  });

  it("extracts two items (event + rsvp) from an invitation/social email", async () => {
    primeOneMessage({
      messageId: "<msg-invite@example.com>",
      from: { text: "friend@example.com" },
      subject: "You're invited!",
      text: "Join us for a birthday party on July 25. Please RSVP by July 18."
    });
    mockComplete.mockResolvedValue(
      extractionResponse([
        {
          kind: "event",
          title: "Birthday party",
          date: "2026-07-25",
          time: null,
          who: null,
          actionRequired: "Attend the birthday party.",
          sourceQuote: "Join us for a birthday party on July 25."
        },
        {
          kind: "rsvp",
          title: "RSVP for birthday party",
          date: "2026-07-18",
          time: null,
          who: null,
          actionRequired: "Reply to confirm attendance.",
          sourceQuote: "Please RSVP by July 18."
        }
      ])
    );

    await pollHouseholdInboxForAllHouseholds();

    const alerts = await qAll<{ action_type: string | null }>(
      `SELECT action_type FROM family_agent_alerts WHERE household_id = ?`,
      HOUSEHOLD_ID
    );
    expect(alerts.length).toBe(2);
    expect(alerts.every(a => a.action_type === "create_gcal_event")).toBe(true);
  });
});
