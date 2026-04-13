import { FormEvent, useState } from "react";
import { Tabs, Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { apiJson, setToken } from "../api";

type AuthTab = "signin" | "signup" | "forgot";

/**
 * Guest landing at `/` — full-screen split hero + auth card with three tabs:
 * Sign In (functional), Sign Up (stub), Forgot Password (stub).
 */
export function HomePage() {
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");

  // Sign-in form state
  const [email, setEmail] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_EMAIL ?? ""
  );
  const [password, setPassword] = useState(
    () => import.meta.env.VITE_DEV_SIGNIN_PASSWORD ?? ""
  );
  const [signInError, setSignInError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sign-up form state
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  // Forgot form state
  const [forgotEmail, setForgotEmail] = useState("");

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setSignInError(null);
    setLoading(true);
    try {
      const data = await apiJson<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
    } catch (err) {
      setSignInError(
        err instanceof Error ? err.message : "Sign in failed. Check your credentials."
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
            <h1 className="home-landing__title">Your money,<br />one calm view</h1>
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

            {/* Feature pills */}
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
              <Tabs
                value={activeTab}
                onChange={(v) => setActiveTab((v ?? "signin") as AuthTab)}
                classNames={{
                  tab: "home-auth-tab",
                  list: "home-auth-tab-list",
                  panel: "home-auth-panel",
                }}
              >
                <Tabs.List grow>
                  <Tabs.Tab value="signin">Sign in</Tabs.Tab>
                  <Tabs.Tab value="signup">Sign up</Tabs.Tab>
                  <Tabs.Tab value="forgot">Forgot?</Tabs.Tab>
                </Tabs.List>

                {/* ── Sign in ──────────────────────────────────────────── */}
                <Tabs.Panel value="signin" pt="md">
                  <form className="home-landing__form" onSubmit={onSignIn}>
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
                    {signInError && (
                      <p className="error home-landing__error">{signInError}</p>
                    )}
                    <button
                      type="submit"
                      className="home-landing__submit"
                      disabled={loading}
                    >
                      {loading ? "Signing in…" : "Sign in"}
                    </button>
                  </form>
                  <p className="home-landing__switch-hint">
                    New here?{" "}
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => setActiveTab("signup")}
                    >
                      Request access
                    </button>
                  </p>
                </Tabs.Panel>

                {/* ── Sign up ──────────────────────────────────────────── */}
                <Tabs.Panel value="signup" pt="md">
                  <Alert
                    icon={<IconInfoCircle size={16} />}
                    color="teal"
                    variant="light"
                    mb="md"
                    radius="md"
                  >
                    Registration requires an invitation from your household
                    admin. Ask them to add you in{" "}
                    <strong>Settings → Household → Members</strong>.
                  </Alert>
                  <form
                    className="home-landing__form"
                    onSubmit={(e) => e.preventDefault()}
                  >
                    <div className="home-landing__field">
                      <label htmlFor="signup-name">Full name</label>
                      <input
                        id="signup-name"
                        type="text"
                        autoComplete="name"
                        value={signUpName}
                        onChange={(e) => setSignUpName(e.target.value)}
                        placeholder="Your name"
                        disabled
                      />
                    </div>
                    <div className="home-landing__field">
                      <label htmlFor="signup-email">Email</label>
                      <input
                        id="signup-email"
                        type="email"
                        autoComplete="email"
                        value={signUpEmail}
                        onChange={(e) => setSignUpEmail(e.target.value)}
                        placeholder="you@example.com"
                        disabled
                      />
                    </div>
                    <div className="home-landing__field">
                      <label htmlFor="signup-password">Password</label>
                      <input
                        id="signup-password"
                        type="password"
                        autoComplete="new-password"
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        placeholder="••••••••"
                        disabled
                      />
                    </div>
                    <button
                      type="button"
                      className="home-landing__submit"
                      disabled
                    >
                      Create account
                    </button>
                  </form>
                  <p className="home-landing__switch-hint">
                    Already have an account?{" "}
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => setActiveTab("signin")}
                    >
                      Sign in
                    </button>
                  </p>
                </Tabs.Panel>

                {/* ── Forgot password ──────────────────────────────────── */}
                <Tabs.Panel value="forgot" pt="md">
                  <Alert
                    icon={<IconInfoCircle size={16} />}
                    color="amber"
                    variant="light"
                    mb="md"
                    radius="md"
                  >
                    Password reset is managed by your household admin. Contact
                    them to reset your password in{" "}
                    <strong>Settings → Security</strong>.
                  </Alert>
                  <form
                    className="home-landing__form"
                    onSubmit={(e) => e.preventDefault()}
                  >
                    <div className="home-landing__field">
                      <label htmlFor="forgot-email">Your email address</label>
                      <input
                        id="forgot-email"
                        type="email"
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        disabled
                      />
                    </div>
                    <button
                      type="button"
                      className="home-landing__submit"
                      disabled
                    >
                      Send reset link
                    </button>
                  </form>
                  <p className="home-landing__switch-hint">
                    Remembered it?{" "}
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => setActiveTab("signin")}
                    >
                      Back to sign in
                    </button>
                  </p>
                </Tabs.Panel>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
