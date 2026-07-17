import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";

export interface AuthController {
  clearError: () => void;
  configured: boolean;
  error: string | null;
  loading: boolean;
  sendEmailCode: (email: string, turnstileToken: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  user: User | null;
  verifyEmailCode: (email: string, code: string) => Promise<boolean>;
}

export function useAuth(): AuthController {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setError(sessionError?.message ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setError(null);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const sendEmailCode = useCallback(async (email: string, turnstileToken: string) => {
    if (!supabase) return false;
    setError(null);
    const response = await fetch("/api/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        turnstileToken,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Unable to send the sign-in email. Please try again.");
      return false;
    }
    return true;
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    if (!supabase) return false;
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (verifyError) {
      setError(verifyError.message);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }, []);

  return {
    clearError,
    configured: isSupabaseConfigured,
    error,
    loading,
    sendEmailCode,
    signOut,
    user,
    verifyEmailCode,
  };
}
