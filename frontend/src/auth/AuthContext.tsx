import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, ApiError, setUnauthorizedHandler } from "../api/client";
import type { Me } from "../api/types";
import i18n from "../i18n";

interface Auth {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

// Never qc.clear(): it would detach the ["me"] observer and the UI would not see the new session.
const setSession = (qc: QueryClient, me: Me | null) => {
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
  qc.setQueryData(["me"], me);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });

  // Any 401 from the API means the session ended: drop cached data so guards redirect to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => setSession(qc, null));
  }, [qc]);

  const me = q.data ?? null;
  const userLang = me?.user.preferred_language;
  useEffect(() => {
    if (userLang && !localStorage.getItem("lang")) void i18n.changeLanguage(userLang);
  }, [userLang]);

  const value: Auth = {
    me,
    loading: q.isLoading,
    login: async (username, password) => {
      await api.get("/auth/csrf").catch(() => undefined);
      const m = await api.post<Me>("/auth/login", { username, password });
      setSession(qc, m);
    },
    logout: async () => {
      await api.post("/auth/logout").catch(() => undefined);
      setSession(qc, null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}
