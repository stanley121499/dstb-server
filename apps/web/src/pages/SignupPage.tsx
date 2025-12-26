import React, { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Email/password signup screen.
 */
export function SignupPage(): React.ReactElement {
  const { actions } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSuccess(null);

      if (!isNonEmpty(email) || !isNonEmpty(password)) {
        setError("Email and password are required");
        return;
      }

      setIsSubmitting(true);

      try {
        await actions.signUpWithEmailPassword(email, password);

        // In many Supabase setups, signUp may require email confirmation.
        setSuccess("Account created. If email confirmation is enabled, check your inbox.");

        // If session is created immediately, user can navigate to the app.
        // We keep it simple and send them to login.
        navigate("/login", { replace: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Signup failed";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [actions, email, navigate, password]
  );

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: "48px auto" }}>
        <div className="cardHeader">
          <p className="h1">Create account</p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Email/password via Supabase Auth.
          </p>
        </div>
        <div className="cardBody">
          {error ? <div className="errorBox" style={{ marginBottom: 12 }}>{error}</div> : null}
          {success ? <div className="successBox" style={{ marginBottom: 12 }}>{success}</div> : null}

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
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </label>

            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Link to="/login" className="muted">
                Back to login
              </Link>
              <button className="btn btnPrimary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create account"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}




