import React, { useCallback } from "react";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { Home, TrendingUp, Settings as SettingsIcon, GitCompare, LogOut, Zap } from "lucide-react";

import { RequireAuth } from "./auth/RequireAuth";
import { useAuth } from "./auth/AuthProvider";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import { cn } from "./lib/utils";

import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RunsListPage } from "./pages/RunsListPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { ParameterSetsPage } from "./pages/ParameterSetsPage";
import { ParameterSetEditorPage } from "./pages/ParameterSetEditorPage";
import { RunBacktestPage } from "./pages/RunBacktestPage";
import { CompareRunsPage } from "./pages/CompareRunsPage";
import { OptimizeParametersPage } from "./pages/OptimizeParametersPage";
import { OptimizationResultsPage } from "./pages/OptimizationResultsPage";

/**
 * Navigation link component with icon support.
 */
function NavItem({ to, icon: Icon, label }: Readonly<{ to: string; icon: React.ElementType; label: string }>): React.ReactElement {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "nav-link",
          isActive && "nav-link-active"
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

/**
 * Application shell with navigation and user menu.
 */
function AppShell(): React.ReactElement {
  const { state, actions } = useAuth();

  const onLogout = useCallback(async () => {
    await actions.signOut();
  }, [actions]);

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="page-container">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-8">
              <NavLink to="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
                  D
                </div>
                <span className="font-semibold text-h3 hidden sm:inline">DSTB</span>
              </NavLink>

              {/* Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                <NavItem to="/" icon={Home} label="Dashboard" />
                <NavItem to="/runs" icon={TrendingUp} label="Runs" />
                <NavItem to="/strategies" icon={SettingsIcon} label="Strategies" />
                <NavItem to="/optimize" icon={Zap} label="Optimize" />
                <NavItem to="/compare" icon={GitCompare} label="Compare" />
              </nav>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-4">
              {state.user && (
                <>
                  <span className="text-small text-muted-foreground hidden sm:inline">
                    {state.user.email}
                  </span>
                  <Separator orientation="vertical" className="h-6" />
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onLogout()}
                disabled={!state.user}
              >
                <LogOut className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav className="md:hidden border-b border-border bg-background">
        <div className="page-container py-2 flex gap-1 overflow-x-auto">
          <NavItem to="/" icon={Home} label="Dashboard" />
          <NavItem to="/runs" icon={TrendingUp} label="Runs" />
          <NavItem to="/strategies" icon={SettingsIcon} label="Strategies" />
          <NavItem to="/optimize" icon={Zap} label="Optimize" />
          <NavItem to="/compare" icon={GitCompare} label="Compare" />
        </div>
      </nav>

      {/* Main Content */}
      <main className="min-h-[calc(100vh-4rem)]">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-secondary/30 py-6 mt-16">
        <div className="page-container">
          <p className="text-caption text-center text-muted-foreground">
            DSTB Backtesting Platform • Built for ORB + ATR Strategies
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Top-level app routes with new information architecture.
 */
export function App(): React.ReactElement {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Protected routes */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        
        {/* Runs */}
        <Route path="/runs" element={<RunsListPage />} />
        <Route path="/runs/new" element={<RunBacktestPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        
        {/* Strategies (formerly Parameter Sets) */}
        <Route path="/strategies" element={<ParameterSetsPage />} />
        <Route path="/strategies/new" element={<ParameterSetEditorPage mode="create" />} />
        <Route path="/strategies/:id" element={<ParameterSetEditorPage mode="edit" />} />
        
        {/* Optimize */}
        <Route path="/optimize" element={<OptimizeParametersPage />} />
        <Route path="/optimize/results" element={<OptimizationResultsPage />} />
        
        {/* Compare */}
        <Route path="/compare" element={<CompareRunsPage />} />
        
        {/* Legacy redirects */}
        <Route path="/parameter-sets" element={<ParameterSetsPage />} />
        <Route path="/parameter-sets/:id" element={<ParameterSetEditorPage mode="edit" />} />
        <Route path="/run" element={<RunBacktestPage />} />
        <Route path="/backtests/:runId" element={<RunDetailPage />} />
        
        {/* 404 */}
        <Route path="*" element={
          <div className="page-container">
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
              <h1 className="text-h1 mb-2">404</h1>
              <p className="text-body text-muted-foreground mb-6">Page not found</p>
              <Button asChild>
                <a href="/">Go to Dashboard</a>
              </Button>
            </div>
          </div>
        } />
      </Route>
    </Routes>
  );
}



