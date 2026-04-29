import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

import { apiFetch, apiJson } from "../api";

type FinancialHealthRating = "strong" | "on_track" | "needs_attention" | "at_risk";

type InsightPayload = {
  healthRating: FinancialHealthRating;
  healthRationale: string;
  localBenchmark: string;
  nationalBenchmark: string;
  whatsWorking: string[];
  concerns: string[];
  spendingAnalysis: string[];
  investmentGaps: string[];
  nextSteps: string[];
};

type InsightRecord = {
  id: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  payload: InsightPayload;
};

type InsightJob = {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  insightId: string | null;
  errorText: string | null;
};

type ProfileForInsight = {
  age: number | null;
  city: string | null;
  state: string | null;
};

function ratingColor(r: FinancialHealthRating): string {
  switch (r) {
    case "strong":
      return "green";
    case "on_track":
      return "blue";
    case "needs_attention":
      return "yellow";
    case "at_risk":
      return "red";
    default:
      return "gray";
  }
}

function ratingLabel(r: FinancialHealthRating): string {
  switch (r) {
    case "strong":
      return "Strong";
    case "on_track":
      return "On track";
    case "needs_attention":
      return "Needs attention";
    case "at_risk":
      return "At risk";
    default:
      return r;
  }
}

function formatInsightDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function locationLabel(city: string | null, state: string | null): string {
  const c = city?.trim();
  const s = state?.trim();
  if (c && s) {
    return `${c}, ${s}`;
  }
  if (s) {
    return s;
  }
  if (c) {
    return c;
  }
  return "your area";
}

export function FinancialHealthCard() {
  const [profile, setProfile] = useState<ProfileForInsight | null>(null);
  const [insight, setInsight] = useState<InsightRecord | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const profileComplete = profile != null && profile.age != null;

  const loadProfile = useCallback(async () => {
    try {
      const [profRes, settingsRes] = await Promise.all([
        apiJson<{ profile: { age: number | null } }>("/household/profile"),
        apiJson<{ city: string | null; state: string | null }>("/household/settings")
      ]);
      setProfile({
        age: profRes.profile.age ?? null,
        city: settingsRes.city ?? null,
        state: settingsRes.state ?? null
      });
    } catch {
      setProfile(null);
    }
  }, []);

  const loadInsight = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; data: InsightRecord | null }>("/insights/financial");
    if (res.ok) {
      setInsight(res.data ?? null);
    } else {
      setInsight(null);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    await loadProfile();
    try {
      await loadInsight();
    } catch {
      setInsight(null);
    } finally {
      setLoading(false);
    }
  }, [loadInsight, loadProfile]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  const pollJob = useCallback(
    async (jobId: string) => {
      setJobError(null);
      const deadline = Date.now() + 120_000;
      try {
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await apiJson<{ ok: boolean; data: InsightJob }>(
            `/insights/financial/status/${encodeURIComponent(jobId)}`
          );
          if (!st.ok) {
            setJobError("Could not read job status.");
            break;
          }
          if (st.data.status === "failed") {
            setJobError(st.data.errorText ?? "Analysis failed.");
            break;
          }
          if (st.data.status === "complete") {
            await loadInsight();
            break;
          }
        }
      } finally {
        setGenerating(false);
      }
    },
    [loadInsight]
  );

  const startRefresh = useCallback(async () => {
    if (generating) {
      return;
    }
    setGenerating(true);
    setJobError(null);
    try {
      const res = await apiFetch("/insights/financial/refresh", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; jobId?: string };
      if (!res.ok || !body.jobId) {
        throw new Error(`HTTP ${res.status}`);
      }
      void pollJob(body.jobId);
    } catch (e: unknown) {
      setJobError(e instanceof Error ? e.message : "Could not start analysis.");
      setGenerating(false);
    }
  }, [generating, pollJob]);

  const localTitle = useMemo(
    () => locationLabel(profile?.city ?? null, profile?.state ?? null),
    [profile?.city, profile?.state]
  );

  if (loading) {
    return (
      <Paper component="section" withBorder p="md" radius="md">
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading financial health…
          </Text>
        </Group>
      </Paper>
    );
  }

  if (!profileComplete) {
    return (
      <Paper component="section" withBorder p="md" radius="md">
        <Text size="sm" c="dimmed">
          Complete your Financial Profile in Settings to enable AI Health Analysis —{" "}
          <Anchor component={Link} to="/settings?tab=profile" size="sm">
            open Profile tab
          </Anchor>
        </Text>
      </Paper>
    );
  }

  return (
    <Paper component="section" withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" mb="sm">
        <div>
          <Group gap="xs" align="center">
            <Title order={4} m={0} fw={600}>
              Financial Health
            </Title>
            {insight ? (
              <Badge color={ratingColor(insight.payload.healthRating)} variant="light">
                {ratingLabel(insight.payload.healthRating)}
              </Badge>
            ) : null}
          </Group>
          {insight ? (
            <Text size="xs" c="dimmed" mt={4}>
              Last updated: {formatInsightDate(insight.generatedAt)} · {insight.provider} {insight.model}
            </Text>
          ) : (
            <Text size="xs" c="dimmed" mt={4}>
              No analysis yet
            </Text>
          )}
        </div>
        <ActionIcon
          type="button"
          variant="light"
          aria-label="Refresh analysis"
          loading={generating}
          disabled={generating}
          onClick={() => void startRefresh()}
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      {generating ? (
        <Group gap="sm" my="md">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Generating analysis… this may take up to 30 seconds
          </Text>
        </Group>
      ) : null}

      {jobError ? (
        <Alert color="red" title="Analysis failed" mb="md">
          <Stack gap="xs">
            <Text size="sm">{jobError}</Text>
            <Button type="button" size="xs" variant="light" onClick={() => void startRefresh()}>
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {!insight && !generating && !jobError ? (
        <Stack gap="sm" my="md">
          <Text size="sm" c="dimmed">
            No analysis yet.
          </Text>
          <Button type="button" size="sm" onClick={() => void startRefresh()}>
            Generate Analysis
          </Button>
        </Stack>
      ) : null}

      {insight ? (
        <>
          <Text size="sm" mt="xs" mb="xs" lineClamp={3}>
            {insight.payload.healthRationale}
          </Text>

          <Accordion variant="separated" radius="md">
            <Accordion.Item value="benchmarks">
              <Accordion.Control>Benchmarks</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Box>
                    <Text size="sm" fw={600}>
                      Local ({localTitle})
                    </Text>
                    <Text size="sm">{insight.payload.localBenchmark}</Text>
                  </Box>
                  <Box>
                    <Text size="sm" fw={600}>
                      National
                    </Text>
                    <Text size="sm">{insight.payload.nationalBenchmark}</Text>
                  </Box>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="working">
              <Accordion.Control>What&apos;s working and concerns</Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  {insight.payload.whatsWorking.map((line, i) => (
                    <Text key={`w-${String(i)}`} size="sm">
                      + {line}
                    </Text>
                  ))}
                  {insight.payload.concerns.map((line, i) => (
                    <Text key={`c-${String(i)}`} size="sm">
                      - {line}
                    </Text>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="details">
              <Accordion.Control>Spending, investment gaps, and next steps</Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  {insight.payload.spendingAnalysis.map((line, i) => (
                    <Text key={`s-${String(i)}`} size="sm">
                      ▸ {line}
                    </Text>
                  ))}
                  {insight.payload.investmentGaps.map((line, i) => (
                    <Text key={`g-${String(i)}`} size="sm">
                      ▸ {line}
                    </Text>
                  ))}
                  {insight.payload.nextSteps.map((line, i) => (
                    <Text key={`n-${String(i)}`} size="sm">
                      ▸ {line}
                    </Text>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          <Group justify="flex-end" mt="md">
            <Anchor component={Link} to="/settings?tab=insights" size="sm">
              View history →
            </Anchor>
          </Group>
        </>
      ) : null}
    </Paper>
  );
}
