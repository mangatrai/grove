import { useNavigate } from "react-router-dom";

/** Marketing / sign-in card for guests only (`/` when not authenticated). */
export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="card">
      <h1>Household Finance</h1>
      <p className="muted">
        Sign in for your cash-flow dashboard, transactions list, and statement imports. Use <strong>New import</strong> in the
        header after you sign in.
      </p>
      <button type="button" onClick={() => navigate("/login")}>
        Sign in
      </button>
    </div>
  );
}
