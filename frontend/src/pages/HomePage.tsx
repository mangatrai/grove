import { FormEvent, useState } from "react";
import { apiJson, setToken } from "../api";

/**
 * Guest landing at `/` — full-screen split hero + clean sign-in card.
 * "Request access" and "Forgot password" are lightweight text links — no
 * separate tabs or full stub forms (those are backlog CRs).
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiJson<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sign in failed. Check your credentials."
      );
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
                <button
                  type="submit"
                  className="home-landing__submit"
                  disabled={loading}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>
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
                  <a
                    href="mailto:admin@household.local"
                    className="home-landing__auth-link"
                    title="Ask your household admin to reset your password in Settings → Security"
                  >
                    Forgot password?
                  </a>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
