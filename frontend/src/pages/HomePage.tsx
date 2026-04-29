import { FormEvent, useState } from "react";
import { Button } from "@mantine/core";
import { setToken } from "../api";

/**
 * Guest landing at `/` — full-screen split hero + clean sign-in card.
 * "Forgot password" shows an inline tip directing the user to their admin;
 * the admin resets passwords from Settings → Members → Reset password.
 */
export function HomePage() {
  const [email, setEmail] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_EMAIL ?? ""
  );
  const [password, setPassword] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_PASSWORD ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotTip, setShowForgotTip] = useState(false);

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
      const data = (await res.json()) as { token: string };
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
            <div className="home-landing__card card">
              <h2 className="home-landing__card-title">Sign in</h2>
              <p className="home-landing__card-sub muted">
                Welcome back — enter your credentials to continue.
              </p>

              <form className="home-landing__form" onSubmit={onSubmit}>
                <div className="home-landing__field">
                  <label htmlFor="home-email">Email</label>
                  <input
                    id="home-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="home-landing__field">
                  <label htmlFor="home-password">Password</label>
                  <input
                    id="home-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {error && (
                  <p className="error home-landing__error">{error}</p>
                )}
                <Button
                  type="submit"
                  fullWidth
                  radius="sm"
                  mt="xs"
                  className="home-landing__submit"
                  color="green"
                  disabled={loading}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>

              {/* Helper links — no full forms; these are backlog CRs */}
              <div className="home-landing__auth-links">
                <span className="home-landing__auth-link-item">
                  New here?{" "}
                  <a
                    href="mailto:admin@household.local"
                    className="home-landing__auth-link"
                    title="Contact your household admin to be added as a member"
                  >
                    Request access
                  </a>
                </span>
                <span className="home-landing__auth-link-sep" aria-hidden>
                  ·
                </span>
                <span className="home-landing__auth-link-item">
                  <button
                    type="button"
                    className="home-landing__auth-link"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    onClick={() => setShowForgotTip((v) => !v)}
                  >
                    Forgot password?
                  </button>
                </span>
                {showForgotTip ? (
                  <div style={{
                    marginTop: "0.6rem", padding: "0.55rem 0.75rem",
                    background: "var(--color-surface-alt, #f0f4ff)",
                    border: "1px solid var(--color-border, #c7d2e8)",
                    borderRadius: 6, fontSize: "0.82rem",
                    color: "var(--color-text, #1e293b)", lineHeight: 1.5
                  }}>
                    Ask your household admin to reset your password.
                    They can do this from <strong>Settings → Members → Reset password</strong>.
                    You'll receive a temporary password and will be prompted to change it on first login.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
