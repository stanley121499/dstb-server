import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { createBrowserSupabaseClient } from "../lib/supabaseClient";

export type AuthState = Readonly<{
  isLoading: boolean;
  user: User | null;
  session: Session | null;
}>;

export type AuthActions = Readonly<{
  signUpWithEmailPassword: (email: string, password: string) => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}>;

export type AuthContextValue = Readonly<{
  state: AuthState;
  actions: AuthActions;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Provides Supabase Auth session state to the app.
 */
export function AuthProvider(props: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [state, setState] = useState<AuthState>(() => ({
    isLoading: true,
    user: null,
    session: null
  }));

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setState({ isLoading: false, user: null, session: null });
        return;
      }

      setState({
        isLoading: false,
        user: data.session?.user ?? null,
        session: data.session
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      setState({
        isLoading: false,
        user: session?.user ?? null,
        session
      });
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signUpWithEmailPassword = useCallback(
    async (email: string, password: string) => {
      if (!isNonEmpty(email) || !isNonEmpty(password)) {
        throw new Error("Email and password are required");
      }

      const { error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        throw new Error(error.message);
      }
    },
    [supabase]
  );

  const signInWithEmailPassword = useCallback(
    async (email: string, password: string) => {
      if (!isNonEmpty(email) || !isNonEmpty(password)) {
        throw new Error("Email and password are required");
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw new Error(error.message);
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  }, [supabase]);

  const value: AuthContextValue = useMemo(
    () => ({
      state,
      actions: {
        signUpWithEmailPassword,
        signInWithEmailPassword,
        signOut
      }
    }),
    [signInWithEmailPassword, signOut, signUpWithEmailPassword, state]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

/**
 * Hook to access Auth state.
 *
 * @throws Error if used outside `AuthProvider`.
 */
export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}




