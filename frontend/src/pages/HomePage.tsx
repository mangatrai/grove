import { FormEvent, useState } from "react";

import { apiJson, setToken } from "../api";

/**
 * Guest landing at `/` — marketing-style hero + inline sign-in (same route as dashboard when authenticated via `HomeRoute`).
 * Inspired by common fintech patterns: split hero, value props, elevated credential card.
 */
export function HomePage() {
  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiJson<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

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
          <div className="home-landing__hero">
            <p className="home-landing__eyebrow">Private · self-hosted</p>
            <h1 className="home-landing__title">Your money, one calm view</h1>
            <p className="home-landing__lead">
              Track cash flow, categories, and imports in one place — built for households that want clarity without
              shipping data to the cloud.
            </p>
            <ul className="home-landing__bullets" aria-label="What you get">
              <li>
                <span className="home-landing__check" aria-hidden>
                  ✓
                </span>
                <span>
                  <strong>Cash snapshot</strong> — inflows, outflows, safe-to-spend, and savings rate on your dashboard.
                </span>
              </li>
              <li>
                <span className="home-landing__check" aria-hidden>
                  ✓
                </span>
                <span>
                  <strong>Statement imports</strong> — upload, parse, and review before your ledger updates.
                </span>
              </li>
              <li>
                <span className="home-landing__check" aria-hidden>
                  ✓
                </span>
                <span>
                  <strong>Categories &amp; rules</strong> — classify transactions and tune behavior over time.
                </span>
              </li>
            </ul>
          </div>

          <div className="home-landing__aside">
            <div className="home-landing__card card">
              <h2 className="home-landing__card-title">Sign in</h2>
              <p className="muted home-landing__card-sub">Defaults match the seed user in <code>.env.example</code>.</p>
              <form className="home-landing__form" onSubmit={onSubmit}>
                <div className="home-landing__field">
                  <label htmlFor="home-email">Email</label>
                  <input
                    id="home-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    required
                  />
                </div>
                {error ? <p className="error home-landing__error">{error}</p> : null}
                <button type="submit" className="home-landing__submit" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
            </div>
            <p className="muted home-landing__footnote">
              Use <strong>New import</strong> in the header to upload statements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
