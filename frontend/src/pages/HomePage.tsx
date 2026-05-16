import { FormEvent, useEffect, useRef, useState } from "react";
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import { setToken } from "../api";
import { GroveMark } from "../components/GroveMark";

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

  // ── Net worth counter animation ──────────────────────────
  const nwValueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = nwValueRef.current;
    if (!el) return;

    const target   = 124_600;
    const duration = 2_200;
    const delay    = 450;

    const timer = setTimeout(() => {
      const t0  = Date.now();
      const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

      const tick = () => {
        const p = Math.min((Date.now() - t0) / duration, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(e * target);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="home-landing">

      {/* ── Hero panel ──────────────────────────────────────────────── */}
      <div className="home-landing__hero">
        <div className="home-landing__glow" aria-hidden />

        <header className="home-landing__brand">
          <div className="home-landing__logo" aria-hidden>
            <GroveMark size={18} color="#fff" />
          </div>
          <span className="home-landing__brand-text">Grove</span>
        </header>

        <div className="home-landing__hero-body">
          <p className="home-landing__eyebrow">Private · self-hosted</p>
          <h1 className="home-landing__title">
            Your money,
            <br />
            one calm view.
          </h1>
          <p className="home-landing__sub">
            For households that want clarity without the cloud.
          </p>

          {/* ── Animated preview cards ──────────────────────────────── */}
          <div className="hl-preview-row">

              {/* ── Card 1: Net worth ── */}
              <div className="hl-card-wrap">
                <div className="hl-snap-card hl-snap-card--nw">

                  <div className="hl-card-header">
                    <span className="hl-card-label">
                      <span className="hl-live-dot" aria-hidden="true" />
                      Net worth
                    </span>
                    <span className="hl-badge">↑ 6.7% YTD</span>
                  </div>

                  <div className="hl-nw-value" ref={nwValueRef}>$0</div>

                  <svg
                    className="hl-mini-chart"
                    viewBox="0 0 260 50"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="hl-chartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#2d6a4f" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#2d6a4f" stopOpacity="0"   />
                      </linearGradient>
                    </defs>

                    <line x1="0" y1="38" x2="260" y2="38"
                      stroke="rgba(45,106,79,0.3)" strokeWidth="1" />
                    <line x1="0" y1="22" x2="260" y2="22"
                      stroke="rgba(45,106,79,0.18)" strokeWidth="1" />

                    <path
                      className="hl-chart-area"
                      d="M 0,44 C 28,42 42,47 62,41 S 92,36 118,34 S 146,26 173,20 S 216,11 260,7 L 260,50 L 0,50 Z"
                      fill="url(#hl-chartFill)"
                    />

                    <path
                      className="hl-chart-line"
                      d="M 0,44 C 28,42 42,47 62,41 S 92,36 118,34 S 146,26 173,20 S 216,11 260,7"
                      stroke="#4a8a6e"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <circle className="hl-chart-dot" cx="260" cy="7" r="10"
                      fill="#2d6a4f" opacity="0.2" />
                    <circle className="hl-chart-dot" cx="260" cy="7" r="3.5"
                      fill="#f0e9d8" opacity="0.9" />
                  </svg>

                  <p className="hl-card-sub">
                    <span className="hl-card-mono">+$8,240</span>
                    {"\u2002"}increase this year
                  </p>

                </div>
              </div>

              {/* ── Card 2: Budget ring ── */}
              <div className="hl-card-wrap">
                <div className="hl-snap-card hl-snap-card--budget">

                  <div className="hl-card-header">
                    <span className="hl-card-label">Budgets</span>
                    <span className="hl-badge hl-badge--gold">May</span>
                  </div>

                  <div className="hl-ring-wrap">
                    <svg
                      className="hl-ring-svg"
                      viewBox="0 0 88 88"
                      fill="none"
                      aria-label="73% of monthly budget used"
                    >
                      <circle cx="44" cy="44" r="34"
                        stroke="rgba(45,106,79,0.2)" strokeWidth="7" />

                      <circle
                        className="hl-ring-progress"
                        cx="44" cy="44" r="34"
                        stroke="#2d6a4f"
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray="214"
                        strokeDashoffset="214"
                        fill="none"
                      />

                      <text
                        x="44" y="41"
                        fontFamily="Inter Tight, Inter, sans-serif"
                        fontWeight="800"
                        fontSize="15"
                        fill="#f0e9d8"
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        73%
                      </text>
                      <text
                        x="44" y="57"
                        fontFamily="Inter, sans-serif"
                        fontSize="7.5"
                        fill="#6b9178"
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        used
                      </text>
                    </svg>
                  </div>

                  <p className="hl-card-sub hl-card-sub--center">
                    <span className="hl-card-mono">$3,840</span>
                    {"\u2002"}of $5,200
                  </p>

                  <div className="hl-cat-pills">
                    <span className="hl-cat-pill">Groceries</span>
                    <span className="hl-cat-pill">Dining</span>
                    <span className="hl-cat-pill">+4</span>
                  </div>

                </div>
              </div>

            </div>{/* /hl-preview-row */}

            {/* ── Recent transactions ─────────────────────────────────── */}
            <div className="hl-txn-section">
              <div className="hl-txn-list">

                <div className="hl-txn">
                  <div className="hl-txn-dot" style={{ background: "#2d6a4f" }} />
                  <span className="hl-txn-name">Whole Foods Market</span>
                  <span className="hl-txn-tag">Groceries</span>
                  <span className="hl-txn-amt hl-txn-amt--d">−$84.32</span>
                </div>

                <div className="hl-txn">
                  <div className="hl-txn-dot" style={{ background: "#c8860a" }} />
                  <span className="hl-txn-name">Payroll · May 2026</span>
                  <span className="hl-txn-tag hl-txn-tag--income">Income</span>
                  <span className="hl-txn-amt hl-txn-amt--c">+$5,200.00</span>
                </div>

                <div className="hl-txn">
                  <div className="hl-txn-dot" style={{ background: "#8a7a68" }} />
                  <span className="hl-txn-name">Netflix</span>
                  <span className="hl-txn-tag hl-txn-tag--sub">Subscriptions</span>
                  <span className="hl-txn-amt hl-txn-amt--d">−$15.99</span>
                </div>

              </div>
          </div>
        </div>
      </div>

      {/* ── Auth panel ──────────────────────────────────────────────── */}
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
                    color="fsForest"
                    loading={loading}
                  >
                    Sign in
                  </Button>
                </Stack>

                {/* Auth helper links */}
                <Text size="xs" c="dimmed" ta="center">
                  New here?{"\u2002"}
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
  );
}
