"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  ChevronDown,
  FileText,
  History,
  LogOut,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserCircle,
} from "lucide-react";

import type { EnhancedQueryItem, SavedCitation, SavedSource, SearchHistoryItem } from "@/types/domain";

interface SignUpResponse {
  ok: boolean;
  data?: {
    message: string;
  };
  error?: {
    message: string;
  };
}

interface SavedSourcesResponse {
  ok: boolean;
  data?: {
    items: SavedSource[];
  };
  error?: {
    message: string;
  };
}

interface SavedCitationsResponse {
  ok: boolean;
  data?: {
    items: SavedCitation[];
  };
  error?: {
    message: string;
  };
}

interface HistoryResponse {
  ok: boolean;
  data?: {
    searchHistory: SearchHistoryItem[];
    enhancedQueries: EnhancedQueryItem[];
  };
  error?: {
    message: string;
  };
}

const savedSections = [
  {
    href: "/saved-history/search",
    label: "Search history",
    description: "Topics and claims you searched",
    key: "searchHistory",
    icon: Search,
  },
  {
    href: "/saved-history/sources",
    label: "Saved sources",
    description: "Articles you bookmarked",
    key: "savedSources",
    icon: BookMarked,
  },
  {
    href: "/saved-history/citations",
    label: "Saved citations",
    description: "Generated bibliography entries",
    key: "savedCitations",
    icon: FileText,
  },
  {
    href: "/saved-history/enhanced",
    label: "Enhanced queries",
    description: "Research plans and refined prompts",
    key: "enhancedQueries",
    icon: Sparkles,
  },
] as const;

type SavedSectionKey = (typeof savedSections)[number]["key"];

type SavedCounts = Record<SavedSectionKey, number>;

const emptyCounts: SavedCounts = {
  searchHistory: 0,
  savedSources: 0,
  savedCitations: 0,
  enhancedQueries: 0,
};

export function AccountMenu() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [counts, setCounts] = useState<SavedCounts>(emptyCounts);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const initials = useMemo(() => {
    const email = session?.user?.email ?? "";
    return email.slice(0, 1).toUpperCase() || "A";
  }, [session?.user?.email]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const loadSavedCounts = useCallback(async () => {
    if (status !== "authenticated") {
      return;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const [sourcesResponse, citationsResponse, historyResponse] = await Promise.all([
        fetch("/api/saved-sources"),
        fetch("/api/saved-citations"),
        fetch("/api/history"),
      ]);

      const sourcesPayload = (await sourcesResponse.json()) as SavedSourcesResponse;
      const citationsPayload = (await citationsResponse.json()) as SavedCitationsResponse;
      const historyPayload = (await historyResponse.json()) as HistoryResponse;

      if (
        !sourcesResponse.ok ||
        !sourcesPayload.ok ||
        !sourcesPayload.data ||
        !citationsResponse.ok ||
        !citationsPayload.ok ||
        !citationsPayload.data ||
        !historyResponse.ok ||
        !historyPayload.ok ||
        !historyPayload.data
      ) {
        throw new Error(
          sourcesPayload.error?.message ||
            citationsPayload.error?.message ||
            historyPayload.error?.message ||
            "Unable to load saved history counts."
        );
      }

      setCounts({
        savedSources: sourcesPayload.data.items.length,
        savedCitations: citationsPayload.data.items.length,
        searchHistory: historyPayload.data.searchHistory.length,
        enhancedQueries: historyPayload.data.enhancedQueries.length,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh saved data.");
    } finally {
      setIsRefreshing(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadSavedCounts();
    }, 0);

    function onSavedDataChanged() {
      void loadSavedCounts();
    }

    window.addEventListener("saved-data-changed", onSavedDataChanged);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("saved-data-changed", onSavedDataChanged);
    };
  }, [loadSavedCounts, status]);

  async function onSignUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSigningUp(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: signUpEmail,
          password: signUpPassword,
        }),
      });

      const payload = (await response.json()) as SignUpResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Sign up failed.");
      }

      setMessage(payload.data.message);
      setSignUpPassword("");
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : "Unable to sign up right now.");
    } finally {
      setIsSigningUp(false);
    }
  }

  async function onLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsLoggingIn(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signIn("credentials", {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      });

      if (!result || result.error) {
        throw new Error("Login failed. Ensure your email is verified and credentials are correct.");
      }

      setMessage("Logged in successfully.");
      setLoginPassword("");
      setIsOpen(false);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Unable to log in right now.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function onLogout() {
    setIsLoggingOut(true);
    setError(null);
    setMessage(null);

    try {
      await signOut({ redirect: false });
      setMessage("Logged out successfully.");
      setIsOpen(false);
    } catch {
      setError("Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function clearAllSavedDataAndHistory() {
    setIsClearingAll(true);
    setError(null);
    setMessage(null);

    try {
      const [historyResponse, sourcesResponse, citationsResponse] = await Promise.all([
        fetch("/api/history?type=all", {
          method: "DELETE",
        }),
        fetch("/api/saved-sources", {
          method: "DELETE",
        }),
        fetch("/api/saved-citations", {
          method: "DELETE",
        }),
      ]);

      if (!historyResponse.ok || !sourcesResponse.ok || !citationsResponse.ok) {
        throw new Error("Unable to clear all saved data and history.");
      }

      setCounts(emptyCounts);
      setMessage("Saved data and history cleared.");
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Unable to clear all saved data and history."
      );
    } finally {
      setIsClearingAll(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account and all saved data permanently?")) {
      return;
    }

    setIsDeletingAccount(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete account.");
      }

      await signOut({ redirect: false });
      setCounts(emptyCounts);
      setMessage("Account deleted successfully.");
      setIsOpen(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete account.");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white">
          {status === "authenticated" ? initials : <UserCircle aria-hidden className="h-5 w-5" />}
        </span>
        <span className="hidden sm:inline">{status === "authenticated" ? "Account" : "Sign in"}</span>
        <ChevronDown aria-hidden className="h-4 w-4 text-slate-500" />
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 z-50 mt-3 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          role="menu"
        >
          <div className="max-h-[calc(100vh-6rem)] overflow-y-auto p-4">
            <div className="flex items-start gap-3 border-b border-slate-200 pb-4">
              <span className="grid h-10 w-10 place-items-center rounded-md bg-slate-900 text-sm font-bold text-white">
                {status === "authenticated" ? initials : <UserCircle aria-hidden className="h-6 w-6" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {status === "authenticated" ? "Account" : "Account access"}
                </p>
                <p className="truncate text-xs text-slate-600">
                  {status === "authenticated"
                    ? session?.user?.email
                    : "Create an account or log in to save history."}
                </p>
              </div>
            </div>

            {status === "authenticated" ? (
              <div className="space-y-4 pt-4">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Saved history</p>
                      <p className="text-xs text-slate-600">Sources, citations, and research trails.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void loadSavedCounts();
                      }}
                      disabled={isRefreshing}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Refresh saved history counts"
                    >
                      <RefreshCw aria-hidden className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {savedSections.map((section) => {
                      const Icon = section.icon;
                      return (
                        <Link
                          key={section.href}
                          href={section.href}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center gap-3 rounded-md border border-slate-200 p-3 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
                            <Icon aria-hidden className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">
                              {section.label}
                            </span>
                            <span className="block text-xs text-slate-600">{section.description}</span>
                          </span>
                          <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white">
                            {counts[section.key]}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onLogout();
                    }}
                    disabled={isLoggingOut}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <LogOut aria-hidden className="h-4 w-4" />
                    {isLoggingOut ? "Logging out..." : "Log out"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void clearAllSavedDataAndHistory();
                    }}
                    disabled={isClearingAll}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <History aria-hidden className="h-4 w-4" />
                    {isClearingAll ? "Clearing..." : "Clear all"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void deleteAccount();
                  }}
                  disabled={isDeletingAccount}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                  {isDeletingAccount ? "Deleting account..." : "Delete account"}
                </button>
              </div>
            ) : (
              <div className="grid gap-5 pt-4">
                <form className="space-y-3" onSubmit={onLoginSubmit}>
                  <p className="text-sm font-semibold text-slate-900">Log in</p>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="Email"
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
                  />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="Password"
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
                  />
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isLoggingIn ? "Logging in..." : "Log in"}
                  </button>
                </form>

                <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={onSignUpSubmit}>
                  <p className="text-sm font-semibold text-slate-900">Create account</p>
                  <input
                    type="email"
                    value={signUpEmail}
                    onChange={(event) => setSignUpEmail(event.target.value)}
                    placeholder="Email"
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
                  />
                  <input
                    type="password"
                    value={signUpPassword}
                    onChange={(event) => setSignUpPassword(event.target.value)}
                    placeholder="Password (min 8 characters)"
                    required
                    minLength={8}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
                  />
                  <button
                    type="submit"
                    disabled={isSigningUp}
                    className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSigningUp ? "Creating account..." : "Create account"}
                  </button>
                </form>
              </div>
            )}

            {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
