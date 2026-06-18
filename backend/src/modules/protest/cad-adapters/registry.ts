import type { CadAdapter } from "./cad-adapter.types.js";
import { DcadAdapter } from "./dcad.adapter.js";

const ADAPTERS: Record<string, CadAdapter> = {
  dcad: new DcadAdapter(),
};

/** Maps a property's state to its default CAD provider string. Returns null for unsupported states. */
export function inferCadProvider(state: string | null | undefined): string | null {
  if (state === "TX") return "dcad";
  return null;
}

/** Returns the adapter for a given provider string, or null if not registered. */
export function getCadAdapter(provider: string): CadAdapter | null {
  return ADAPTERS[provider] ?? null;
}
