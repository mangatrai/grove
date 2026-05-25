import { useState, useCallback } from "react";
import { apiFetch } from "../api";
import type { YearSummaryResponse } from "../components/year-review/types";

export function useYearSummary(year: number) {
  const [data, setData] = useState<YearSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/reports/year-summary?year=${year}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData((await res.json()) as YearSummaryResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load year summary");
    } finally {
      setLoading(false);
    }
  }, [year]);

  return { data, loading, error, load };
}
