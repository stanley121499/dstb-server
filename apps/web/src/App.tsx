import React, { useCallback } from "react";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { useAuth } from "./auth/AuthProvider";

import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";

import { ParameterSetsPage } from "./pages/ParameterSetsPage";
import { ParameterSetEditorPage } from "./pages/ParameterSetEditorPage";
import { RunBacktestPage } from "./pages/RunBacktestPage";
import { BacktestResultsPage } from "./pages/BacktestResultsPage";
import { CompareRunsPage } from "./pages/CompareRunsPage";

function navClassName(isActive: boolean): string {
  return ["navItem", isActive ? "navItemActive" : ""].filter((x) => x.length > 0).join(" ");
}

function Home(): React.ReactElement {
  return (
    <div className="container">
      <div className="card">
        <div className="cardHeader">
          <p className="h1">DSTB</p>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Backtesting UI for ORB + ATR.
          </p>
        </div>
        <div className="cardBody">
          <p style={{ marginTop: 0 }}>
            Use the nav to manage parameter sets, run backtests, and inspect results.
          </p>
        </div>
      </div>
    </div>
  );
}

function AppShell(): React.ReactElement {
  const { state, actions } = useAuth();

  const onLogout = useCallback(async () => {
    await actions.signOut();
  }, [actions]);

  return (
    <div>
      <div className="container" style={{ paddingBottom: 0 }}>
        <div className="card">
          <div className="cardBody" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div className="nav">
              <NavLink to="/" className={({ isActive }) => navClassName(isActive)}>
                Home
              </NavLink>
              <NavLink to="/parameter-sets" className={({ isActive }) => navClassName(isActive)}>
                Parameter Sets
              </NavLink>
              <NavLink to="/run" className={({ isActive }) => navClassName(isActive)}>
                Run Backtest
              </NavLink>
              <NavLink to="/compare" className={({ isActive }) => navClassName(isActive)}>
                Compare Runs
              </NavLink>
            </div>

            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {state.user ? `Signed in: ${state.user.email ?? ""}` : "Not signed in"}
              </span>
              <button className="btn" type="button" onClick={() => void onLogout()} disabled={!state.user}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <Outlet />
    </div>
  );
}

/**
 * Top-level app routes.
 */
export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/parameter-sets" element={<ParameterSetsPage />} />
        <Route path="/parameter-sets/new" element={<ParameterSetEditorPage mode="create" />} />
        <Route path="/parameter-sets/:id" element={<ParameterSetEditorPage mode="edit" />} />
        <Route path="/run" element={<RunBacktestPage />} />
        <Route path="/backtests/:runId" element={<BacktestResultsPage />} />
        <Route path="/compare" element={<CompareRunsPage />} />
        <Route path="*" element={<div className="container">Not found</div>} />
      </Route>
    </Routes>
  );
}
