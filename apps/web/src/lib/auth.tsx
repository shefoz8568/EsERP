"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, getRefreshToken, setTokens, settingsApi } from "./api";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** MFA token issued by /auth/login when mfaRequired is true. */
  mfaToken: string | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  register: (input: {
    tenantName: string;
    companyName: string;
    email: string;
    password: string;
    locale: string;
  }) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth state. Tokens are held in the api module's in-memory store and
 * mirrored to localStorage (see src/lib/api.ts) so the session survives
 * a locale switch — which remounts this provider, because the [locale]
 * layout owns <Providers> — and a full page reload.
 *
 * NOTE (contract deviation, real API): the API does NOT set an httpOnly
 * refresh cookie; POST /auth/refresh takes { refreshToken } in the body.
 * There is therefore no cookie-backed refresh flow to use; the
 * localStorage persistence is a deliberate dev-grade tradeoff, see the
 * security note in src/lib/api.ts. Within a single page session, 401s
 * are still auto-refreshed by the api client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Tokens are hydrated from localStorage at api-module load, so
        // after a locale switch (which remounts this provider) or a
        // reload there IS a refresh token to restore from. authApi
        // .refresh() rotates + persists the new pair before /me runs.
        if (!getRefreshToken()) {
          setLoading(false);
          return;
        }
        await authApi.refresh();
        const { user: me } = await authApi.me();
        if (!cancelled) setUser(me);
      } catch {
        setTokens(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    if (res.mfaRequired) {
      setMfaToken(res.mfaToken ?? null);
      return { mfaRequired: true };
    }
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken ?? "" });
    setUser(res.user);
    setMfaToken(null);
    // The login response carries no permissions; fetch /auth/me so the
    // UI can gate tabs/buttons on them right away instead of waiting
    // for the next mount. Best-effort: the login user stays if it fails.
    void authApi.me().then(({ user: me }) => setUser(me)).catch(() => undefined);
    return { mfaRequired: false };
  }, []);

  const register = useCallback(
    async (input: {
      tenantName: string;
      companyName: string;
      email: string;
      password: string;
      locale: string;
    }) => {
      const res = await authApi.register({
        tenantName: input.tenantName,
        email: input.email,
        password: input.password,
        defaultLocale: input.locale,
      });
      setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken ?? "" });
      setUser(res.user);
      // The register DTO has no company-name field (the API seeds the
      // company profile from the tenant name); apply the entered company
      // name to the profile best-effort — never block registration on it.
      try {
        await settingsApi.updateCompany({
          legalName: input.companyName,
          tradeName: input.companyName,
        });
      } catch {
        // Company profile edit is available later in Settings.
      }
    },
    [],
  );

  const verifyMfa = useCallback(
    async (code: string) => {
      if (!mfaToken) throw new Error("No MFA session. Please log in again.");
      const res = await authApi.verifyMfa({ mfaToken, code });
      setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken ?? "" });
      setUser(res.user);
      setMfaToken(null);
      // As in login: the MFA response carries no permissions.
      void authApi.me().then(({ user: me }) => setUser(me)).catch(() => undefined);
    },
    [mfaToken],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Logging out locally even if the API call fails.
    }
    setTokens(null);
    setUser(null);
    setMfaToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, mfaToken, login, register, verifyMfa, logout }),
    [user, loading, mfaToken, login, register, verifyMfa, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Redirects to /[locale]/login while the user is not authenticated. */
export function RequireAuth({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace(`/${locale}/login`);
  }, [loading, user, locale, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}
