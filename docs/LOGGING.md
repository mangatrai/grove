# Logging

## Backend: `LOG_LEVEL`

The API reads **`LOG_LEVEL`** from the **repository root** `.env` (same file as other backend variables; see [`backend/src/config/env.ts`](../backend/src/config/env.ts)).

| Value | Behavior |
|-------|----------|
| `debug` | Emit `log.debug`, `log.info`, `log.warn`, `log.error` |
| `info` | Default. Emit `log.info` and above (hides `debug`) |
| `warn` | Emit `log.warn` and `log.error` only |
| `error` | Emit `log.error` only |
| `silent` | Suppress all `log.*` output |

Implementation: [`backend/src/logger.ts`](../backend/src/logger.ts). **`logger.ts` is the only module** that may write to `console` or to the optional log file; other backend code should use `import { log } from "./logger.js"`.

## `LOG_FILE` (in-process append)

Set **`LOG_FILE`** in the repo root `.env` to a path such as `.runtime/logs/api.log` (repo-relative or absolute). The process will **create parent directories**, append **ISO timestamp + level + message** lines, and **still** print to the console (tee). If the file cannot be opened, logging continues on the console only and a one-time warning is emitted.

`LOG_LEVEL` still filters which severities are emitted to **both** sinks.

## Capturing logs to files (dev)

`npm run start:dev` (same as `npm run services:start`) runs backend and frontend in the background and appends their stdout/stderr to **`.runtime/logs/backend.log`** and **`.runtime/logs/frontend.log`**. Tail, for example:

```bash
tail -f .runtime/logs/backend.log
```

## Follow-up work

See GitHub issue [#10](https://github.com/mangatrai/household-finance-app/issues/10): migrate remaining `console.*` in the backend to `log`, optional structured JSON logs (e.g. pino), request/access logging, and frontend dev verbosity if needed.
