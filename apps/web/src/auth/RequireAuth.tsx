import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./AuthProvider";

/**
 * Route guard that requires a Supabase session.
 */
export function RequireAuth(props: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  const { state } = useAuth();
  const location = useLocation();

  if (state.isLoading) {
    return <div className="container">Loading...</div>;
  }

  if (!state.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{props.children}</>;
}
