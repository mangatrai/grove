import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export default async function globalSetup() {
  const { getSql } = await import("../src/db/query.js");
  await getSql();

  return async function teardown() {
    const script = path.join(repoRoot, "scripts", "clean-import-session-dirs.mjs");
    const mod = (await import(pathToFileURL(script).href)) as {
      default: () => Promise<void>;
    };
    await mod.default();
  };
}
