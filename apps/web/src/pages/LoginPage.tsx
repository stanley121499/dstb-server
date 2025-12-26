import React, { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { getRecordProp, isRecord } from "../lib/typeGuards";

function readFromPath(value: unknown): string {
  if (!isRecord(value)) {
    return "/";
  }

  const from = getRecordProp(value, "from");

  return typeof from === "string" && from.startsWith("/") ? from : "/";
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Email/password login screen.
 */
export function LoginPage(): React.ReactElement {
  const { actions } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const fromPath = useMemo(() => {
    return readFromPath(location.state);
  }, [location.state]);

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!isNonEmpty(email) || !isNonEmpty(password)) {
        setError("Email and password are required");
        return;
      }

      setIsSubmitting(true);

      try {
        await actions.signInWithEmailPassword(email, password);
        navigate(fromPath, { replace: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Login failed";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [actions, email, fromPath, navigate, password]
  );

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: "48px auto" }}>
        <div className="cardHeader">
          <p className="h1">Login</p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Email/password via Supabase Auth.
          </p>
        </div>
        <div className="cardBody">
          {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}

          <form onSubmit={onSubmit} className="col" style={{ gap: 12 }}>
            <label className="col">
              <span className="label">Email</span>
              <input
                className="input"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                type="email"
                autoComplete="email"
                spellCheck={false}
                inputMode="email"
                placeholder="you@example.com"
              />
            </label>

            <label className="col">
              <span className="label">Password</span>
              <input
                className="input"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>

            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Link to="/signup" className="muted">
                Create an account
              </Link>
              <button className="btn btnPrimary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Logging in..." : "Login"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}




