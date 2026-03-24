import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiJson, getToken, setToken } from "../api";

export function HomePage() {
  const navigate = useNavigate();
  const token = getToken();
  const [startErr, setStartErr] = useState<string | null>(null);

  async function startImport() {
    setStartErr(null);
    try {
      const data = await apiJson<{ session: { id: string } }>("/imports/sessions", {
        method: "POST",
        body: JSON.stringify({ sourceType: "upload" })
      });
      navigate(`/imports/${data.session.id}`);
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : "Could not create session. Is the backend running?");
    }
  }

  function logout() {
    setToken(null);
    navigate("/login", { replace: true });
  }

  if (!token) {
    return (
      <div className="card">
        <h1>Household Finance</h1>
        <p className="muted">Sign in to upload statements and run imports.</p>
        <button type="button" onClick={() => navigate("/login")}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Household Finance</h1>
      <p className="muted">
        Import statements, then review the <Link to="/transactions">ledger</Link> to confirm rows landed.
      </p>
      {startErr ? <p className="error">{startErr}</p> : null}
      <div className="row">
        <button type="button" onClick={() => void startImport()}>
          New import session
        </button>
        <button type="button" className="secondary" onClick={() => navigate("/transactions")}>
          View ledger
        </button>
        <button type="button" className="secondary" onClick={() => navigate("/resolution")}>
          Review queue
        </button>
        <button type="button" className="secondary" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
