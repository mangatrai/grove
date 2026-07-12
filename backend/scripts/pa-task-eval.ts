/**
 * Manual eval for the PA task loop (#164, #166) against real providers (LLM + Tavily).
 * Not part of `npm test` — CI only covers loop mechanics with mocked adapters
 * (backend/tests/pa-task-runner.test.ts). Run this before shipping any change to
 * pa-task-runner.ts to eyeball synthesis quality against the A6 honesty rules:
 * every price/availability claim must cite a ledger source + date, never assert a
 * live quote, and say "could not verify" when the ledger doesn't support a claim.
 *
 * Usage (from repo): `npm run pa-task-eval -w backend -- "<goal>" [householdId]`
 * Defaults to the first household in the DB if no householdId is given.
 */
import { qGet } from "../src/db/query.js";
import { runPATask } from "../src/modules/family/pa-task-runner.js";

const SCENARIOS = [
  "Find a few gift ideas for a 10 year old who likes dinosaurs and building sets, under $40, with links.",
  "Find weekend kids' activities or classes happening in the next two weeks.",
  "Look into flight prices for a domestic weekend trip in the next two months and summarize the cheapest options found.",
];

async function main(): Promise<void> {
  const goalArg = process.argv[2];
  const householdIdArg = process.argv[3];

  const householdId = householdIdArg ?? (await qGet<{ id: string }>(`SELECT id FROM household ORDER BY created_at ASC LIMIT 1`))?.id;
  if (!householdId) {
    console.error("No household found in the DB. Pass a householdId explicitly, or seed one first.");
    process.exit(1);
  }

  const goals = goalArg ? [goalArg] : SCENARIOS;

  for (const goal of goals) {
    console.log(`\n${"=".repeat(80)}\nGOAL: ${goal}\nhouseholdId: ${householdId}\n${"=".repeat(80)}`);
    const started = Date.now();
    const result = await runPATask(goal, householdId);
    const elapsedMs = Date.now() - started;

    if (!result.ok) {
      console.log(`REFUSED: ${result.code} — ${result.message}`);
      continue;
    }

    console.log(`\niterationsUsed=${result.data.iterationsUsed} hitIterationCap=${result.data.hitIterationCap} elapsedMs=${elapsedMs}`);
    console.log(`\nSUMMARY:\n${result.data.summary}`);
    if (result.data.actions.length > 0) {
      console.log(`\nACTIONS:\n${JSON.stringify(result.data.actions, null, 2)}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
