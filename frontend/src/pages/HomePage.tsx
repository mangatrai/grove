import { FormEvent, useEffect, useState } from "react";
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import { setToken } from "../api";

/**
 * Guest landing at `/` — full-screen split hero + clean sign-in card.
 * "Forgot password" shows an inline tip directing the user to their admin;
 * the admin resets passwords from Settings → Members → Reset password.
 */
export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_EMAIL ?? ""
  );
  const [password, setPassword] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_PASSWORD ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotTip, setShowForgotTip] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [showForgotForm, setShowForgotForm] = useState(false);
  const [showResetSuccess, setShowResetSuccess] = useState(() => searchParams.get("reset") === "1");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/auth/capabilities");
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as { emailEnabled?: boolean };
        if (!cancelled) {
          setEmailEnabled(Boolean(body.emailEnabled));
        }
      } catch {
        // keep default false and preserve existing admin-tip fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onForgotPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setForgotLoading(true);
    try {
      await fetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail })
      });
    } catch {
      // Response stays identical to avoid enumeration and avoid leaking infra state.
    } finally {
      setForgotLoading(false);
      setForgotSent(true);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Use raw fetch — apiJson would convert any 401 to "Session expired",
      // but here 401 means wrong credentials, not an expired session.
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = "Sign in failed. Check your credentials.";
        try {
          const parsed = JSON.parse(body) as { message?: string };
          if (parsed.message) msg = parsed.message;
        } catch { /* use fallback */ }
        setError(msg);
        return;
      }
      const data = (await res.json()) as { token: string; forcePasswordChange?: boolean };
      try {
        if (data.forcePasswordChange) {
          sessionStorage.setItem("hf_login_force_password_change", "1");
        } else {
          sessionStorage.removeItem("hf_login_force_password_change");
        }
      } catch {
        /* ignore */
      }
      setToken(data.token);
    } catch {
      setError("Sign in failed. Check your network connection.");
    } finally {
      setLoading(false);
    }
  }

  const featurePills = [
    "Cash flow",
    "Budgets",
    "Net worth",
    "Payslips",
    "Imports",
    "Categories",
  ];

  return (
    <div className="home-landing">
      <div className="home-landing__glow" aria-hidden />
      <div className="home-landing__wrap">
        <header className="home-landing__brand">
          <span className="home-landing__logo" aria-hidden>
            HF
          </span>
          <span className="home-landing__brand-text">Household Finance</span>
        </header>

        <div className="home-landing__grid">
          {/* ── Hero ──────────────────────────────────────────────────── */}
          <div className="home-landing__hero">
            <p className="home-landing__eyebrow">Private · self-hosted</p>
            <h1 className="home-landing__title">
              Your money,
              <br />
              one calm view
            </h1>
            <p className="home-landing__lead">
              Track cash flow, categories, and imports in one place — built for
              households that want clarity without shipping data to the cloud.
            </p>
            <ul className="home-landing__bullets" aria-label="What you get">
              <li>
                <span className="home-landing__check" aria-hidden>✓</span>
                <span>
                  <strong>Cash snapshot</strong> — inflows, outflows,
                  safe-to-spend, and savings rate on your dashboard.
                </span>
              </li>
              <li>
                <span className="home-landing__check" aria-hidden>✓</span>
                <span>
                  <strong>Statement imports</strong> — upload, parse, and review
                  before your ledger updates.
                </span>
              </li>
              <li>
                <span className="home-landing__check" aria-hidden>✓</span>
                <span>
                  <strong>Categories &amp; rules</strong> — classify transactions
                  and tune behavior over time.
                </span>
              </li>
              <li>
                <span className="home-landing__check" aria-hidden>✓</span>
                <span>
                  <strong>Budgets &amp; net worth</strong> — monthly targets,
                  balance sheet, and trend charts.
                </span>
              </li>
            </ul>

            <div className="home-landing__pills" aria-hidden>
              {featurePills.map((p) => (
                <span key={p} className="home-landing__pill">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* ── Auth card ─────────────────────────────────────────────── */}
          <div className="home-landing__aside">
            <Paper withBorder shadow="sm" radius="md" p="lg">
              <Stack gap="md">
                <div>
                  <Text fw={600} size="lg">Sign in</Text>
                  <Text c="dimmed" size="sm">Welcome back — enter your credentials to continue.</Text>
                </div>

                {showResetSuccess ? (
                  <Alert
                    color="green"
                    variant="light"
                    withCloseButton
                    onClose={() => {
                      setShowResetSuccess(false);
                      const next = new URLSearchParams(searchParams);
                      next.delete("reset");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    Password updated — please sign in.
                  </Alert>
                ) : null}

                <Stack gap="sm" component="form" onSubmit={onSubmit}>
                  <TextInput
                    id="home-email"
                    label="Email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <PasswordInput
                    id="home-password"
                    label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    error={error ?? undefined}
                  />
                  <Button
                    type="submit"
                    fullWidth
                    radius="sm"
                    color="green"
                    loading={loading}
                  >
                    Sign in
                  </Button>
                </Stack>

                {/* Auth helper links */}
                <Text size="xs" c="dimmed" ta="center">
                  New here?{" "}
                  <Anchor href="mailto:admin@household.local" size="xs" title="Contact your household admin to be added as a member">
                    Request access
                  </Anchor>
                  {" · "}
                  {emailEnabled ? (
                    <>
                      {forgotSent ? (
                        <Text size="xs" c="dimmed" span>If that address is registered, a link is on its way.</Text>
                      ) : showForgotForm ? (
                        <Stack gap={6} component="form" onSubmit={onForgotPasswordSubmit} mt={4}>
                          <TextInput
                            type="email"
                            size="xs"
                            placeholder="your@email.com"
                            value={forgotEmail}
                            onChange={(event) => setForgotEmail(event.currentTarget.value)}
                            required
                          />
                          <Button type="submit" size="xs" variant="default" loading={forgotLoading} fullWidth>
                            Send reset link
                          </Button>
                        </Stack>
                      ) : (
                        <Anchor size="xs" component="button" type="button" onClick={() => setShowForgotForm(true)}>
                          Forgot password?
                        </Anchor>
                      )}
                    </>
                  ) : (
                    <>
                      <Anchor size="xs" component="button" type="button" onClick={() => setShowForgotTip((v) => !v)}>
                        Forgot password?
                      </Anchor>
                      {showForgotTip ? (
                        <Paper withBorder p="xs" mt={6} radius="sm">
                          <Text size="xs" c="dimmed" lh={1.5}>
                            Ask your household admin to reset your password.
                            They can do this from <Text span fw={600}>Settings → Members → Reset password</Text>.
                            You'll receive a temporary password and will be prompted to change it on first login.
                          </Text>
                        </Paper>
                      ) : null}
                    </>
                  )}
                </Text>
              </Stack>
            </Paper>
          </div>
        </div>
      </div>
    </div>
  );
}
