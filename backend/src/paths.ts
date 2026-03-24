import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (monorepo), resolved from this file location. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveDataPath(relativePath: string): string {
  return path.resolve(repoRoot, relativePath);
}
