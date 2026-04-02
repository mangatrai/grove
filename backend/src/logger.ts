import fs from "node:fs";
import path from "node:path";
import util from "node:util";

import { env, resolveLogFilePath } from "./config/env.js";

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;

type LogLevel = keyof typeof LEVEL_ORDER;

function minLevel(): number {
  return LEVEL_ORDER[env.LOG_LEVEL];
}

function enabled(level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_ORDER[level] >= minLevel();
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 6, breakLength: 120 })))
    .join(" ");
}

type LineLabel = "DEBUG" | "INFO" | "WARN" | "ERROR";

let fileStream: fs.WriteStream | null = null;
let fileSinkDisabled = false;
let warnedFileFailure = false;

function getFileStream(): fs.WriteStream | null {
  if (fileSinkDisabled) {
    return null;
  }
  if (fileStream) {
    return fileStream;
  }
  const abs = resolveLogFilePath();
  if (!abs) {
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const stream = fs.createWriteStream(abs, { flags: "a" });
    stream.on("error", (err) => {
      fileSinkDisabled = true;
      fileStream = null;
      if (!warnedFileFailure) {
        warnedFileFailure = true;
        console.warn("[logger] LOG_FILE stream error:", err instanceof Error ? err.message : err);
      }
    });
    fileStream = stream;
    return stream;
  } catch (e) {
    fileSinkDisabled = true;
    if (!warnedFileFailure) {
      warnedFileFailure = true;
      console.warn("[logger] Could not open LOG_FILE:", e instanceof Error ? e.message : e);
    }
    return null;
  }
}

function writeFileLine(line: string): void {
  const stream = getFileStream();
  if (!stream || fileSinkDisabled) {
    return;
  }
  stream.write(line, (err) => {
    if (err) {
      fileSinkDisabled = true;
      fileStream = null;
      if (!warnedFileFailure) {
        warnedFileFailure = true;
        console.warn("[logger] LOG_FILE write failed:", err instanceof Error ? err.message : err);
      }
    }
  });
}

function emit(
  level: Exclude<LogLevel, "silent">,
  label: LineLabel,
  consoleFn: (...args: unknown[]) => void,
  args: unknown[]
): void {
  if (!enabled(level)) {
    return;
  }
  const text = formatArgs(args);
  const line = `${new Date().toISOString()} [${label}] ${text}\n`;
  const oneLine = line.trimEnd();
  consoleFn(oneLine);
  if (resolveLogFilePath()) {
    writeFileLine(line);
  }
}

/**
 * Backend logging controlled by `LOG_LEVEL` and optional `LOG_FILE` in root `.env` (see `env.ts`).
 * Use instead of `console.*` elsewhere in `backend/src`.
 */
export const log = {
  debug(...args: unknown[]): void {
    emit("debug", "DEBUG", console.debug, args);
  },
  info(...args: unknown[]): void {
    emit("info", "INFO", console.log, args);
  },
  warn(...args: unknown[]): void {
    emit("warn", "WARN", console.warn, args);
  },
  error(...args: unknown[]): void {
    emit("error", "ERROR", console.error, args);
  }
};
