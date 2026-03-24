import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/**
 * After all test files finish, remove data/imports/<uuid>/ so integration tests do not accumulate staging dirs.
 */
export default function globalSetup() {
  return async function teardown() {
    const script = path.join(repoRoot, "scripts", "clean-import-session-dirs.mjs");
    const mod = (await import(pathToFileURL(script).href)) as {
      default: () => Promise<void>;
    };
    await mod.default();
  };
}
