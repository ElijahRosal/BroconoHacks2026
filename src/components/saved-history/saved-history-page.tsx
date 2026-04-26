"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/async-state";
import { START_MODES } from "@/lib/constants";
import type { EnhancedQueryItem, SavedCitation, SavedSource, SearchHistoryItem } from "@/types/domain";

export type SavedHistorySection = "overview" | "search" | "sources" | "citations" | "enhanced";

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

interface SavedHistoryData {
  searchHistory: SearchHistoryItem[];
  savedSources: SavedSource[];
  savedCitations: SavedCitation[];
  enhancedQueries: EnhancedQueryItem[];
}

const emptyData: SavedHistoryData = {
  searchHistory: [],
  savedSources: [],
  savedCitations: [],
  enhancedQueries: [],
};

const startModeLabels = new Map(START_MODES.map((mode) => [mode.value, mode.label]));

const sections = {
  overview: {
    title: "Saved History",
    description: "Open a saved section to review, cite, reuse, or clean up your work.",
    href: "/saved-history",
    backHref: "/",
    backLabel: "Back to search",
    icon: BookMarked,
  },
  search: {
    title: "Search History",
    description: "Topics, claims, and prompts you searched.",
    href: "/saved-history/search",
    backHref: "/saved-history",
    backLabel: "Back to saved history",
    icon: Search,
  },
  sources: {
    title: "Saved Sources",
    description: "Academic sources you saved for later.",
    href: "/saved-history/sources",
    backHref: "/saved-history",
    backLabel: "Back to saved history",
    icon: BookMarked,
  },
  citations: {
    title: "Saved Citations",
    description: "Generated bibliography entries saved to your account.",
    href: "/saved-history/citations",
    backHref: "/saved-history",
    backLabel: "Back to saved history",
    icon: FileText,
  },
  enhanced: {
    title: "Enhanced Queries",
    description: "Research plans, refined questions, and enhanced search paths.",
    href: "/saved-history/enhanced",
    backHref: "/saved-history",
    backLabel: "Back to saved history",
    icon: Sparkles,
  },
} satisfies Record<SavedHistorySection, {
  title: string;
  description: string;
  href: string;
  backHref: string;
  backLabel: string;
  icon: typeof BookMarked;
}>;

const overviewSections = [
  {
    section: "search",
    countKey: "searchHistory",
  },
  {
    section: "sources",
    countKey: "savedSources",
  },
  {
    section: "citations",
    countKey: "savedCitations",
  },
  {
    section: "enhanced",
    countKey: "enhancedQueries",
  },
] as const;

function formatTimestamp(isoValue: string) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }

  return parsed.toLocaleString();
}

function formatPublicationDate(rawDate: string) {
  if (!rawDate) {
    return "Unknown date";
  }

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }

  return parsed.toLocaleDateString();
}

function formatAuthors(authors: string[]) {
  if (authors.length === 0) {
    return "Unknown authors";
  }

  return authors.join(", ");
}

function getSectionItems(data: SavedHistoryData, section: SavedHistorySection) {
  if (section === "search") {
    return data.searchHistory;
  }

  if (section === "sources") {
    return data.savedSources;
  }

  if (section === "citations") {
    return data.savedCitations;
  }

  if (section === "enhanced") {
    return data.enhancedQueries;
  }

  return [];
}

export function SavedHistoryPage({ section }: { section: SavedHistorySection }) {
  const { status } = useSession();
  const [data, setData] = useState<SavedHistoryData>(emptyData);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [deletingItemIds, setDeletingItemIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const config = sections[section];
  const Icon = config.icon;

  const counts = useMemo(
    () => ({
      searchHistory: data.searchHistory.length,
      savedSources: data.savedSources.length,
      savedCitations: data.savedCitations.length,
      enhancedQueries: data.enhancedQueries.length,
    }),
    [data]
  );

  const currentItems = getSectionItems(data, section);

  const loadSavedData = useCallback(async () => {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
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
            "Unable to load saved history."
        );
      }

      setData({
        savedSources: sourcesPayload.data.items,
        savedCitations: citationsPayload.data.items,
        searchHistory: historyPayload.data.searchHistory,
        enhancedQueries: historyPayload.data.enhancedQueries,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load saved history.");
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadSavedData();
    }, 0);

    function onSavedDataChanged() {
      void loadSavedData();
    }

    window.addEventListener("saved-data-changed", onSavedDataChanged);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("saved-data-changed", onSavedDataChanged);
    };
  }, [loadSavedData, status]);

  async function clearCurrentSection() {
    if (section === "overview") {
      return;
    }

    setIsClearing(true);
    setError(null);

    try {
      const response =
        section === "search"
          ? await fetch("/api/history?type=search", { method: "DELETE" })
          : section === "enhanced"
            ? await fetch("/api/history?type=enhanced", { method: "DELETE" })
            : section === "sources"
              ? await fetch("/api/saved-sources", { method: "DELETE" })
              : await fetch("/api/saved-citations", { method: "DELETE" });

      if (!response.ok) {
        throw new Error(`Unable to clear ${config.title.toLowerCase()}.`);
      }

      setData((current) => ({
        ...current,
        ...(section === "search" ? { searchHistory: [] } : {}),
        ...(section === "enhanced" ? { enhancedQueries: [] } : {}),
        ...(section === "sources" ? { savedSources: [] } : {}),
        ...(section === "citations" ? { savedCitations: [] } : {}),
      }));
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : `Unable to clear ${config.title.toLowerCase()}.`
      );
    } finally {
      setIsClearing(false);
    }
  }

  async function deleteSearchHistoryItem(itemId: string, type: "search" | "enhanced") {
    setDeletingItemIds((current) => [...current, itemId]);
    setError(null);

    try {
      const response = await fetch(
        `/api/history/${encodeURIComponent(itemId)}?type=${encodeURIComponent(type)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Unable to delete history item.");
      }

      setData((current) => ({
        ...current,
        searchHistory:
          type === "search"
            ? current.searchHistory.filter((item) => item.id !== itemId)
            : current.searchHistory,
        enhancedQueries:
          type === "enhanced"
            ? current.enhancedQueries.filter((item) => item.id !== itemId)
            : current.enhancedQueries,
      }));
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete history item.");
    } finally {
      setDeletingItemIds((current) => current.filter((id) => id !== itemId));
    }
  }

  async function deleteSavedSourceItem(itemId: string) {
    setDeletingItemIds((current) => [...current, itemId]);
    setError(null);

    try {
      const response = await fetch(`/api/saved-sources/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete saved source.");
      }

      setData((current) => ({
        ...current,
        savedSources: current.savedSources.filter((item) => item.id !== itemId),
      }));
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete saved source.");
    } finally {
      setDeletingItemIds((current) => current.filter((id) => id !== itemId));
    }
  }

  async function deleteSavedCitationItem(itemId: string) {
    setDeletingItemIds((current) => [...current, itemId]);
    setError(null);

    try {
      const response = await fetch(`/api/saved-citations/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete saved citation.");
      }

      setData((current) => ({
        ...current,
        savedCitations: current.savedCitations.filter((item) => item.id !== itemId),
      }));
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete saved citation."
      );
    } finally {
      setDeletingItemIds((current) => current.filter((id) => id !== itemId));
    }
  }

  function renderOverview() {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {overviewSections.map((item) => {
          const sectionConfig = sections[item.section];
          const SectionIcon = sectionConfig.icon;

          return (
            <Link
              key={item.section}
              href={sectionConfig.href}
              className="group flex min-h-32 items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
                <SectionIcon aria-hidden className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  {sectionConfig.title}
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {counts[item.countKey]}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-slate-600">{sectionConfig.description}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700"
              />
            </Link>
          );
        })}
      </div>
    );
  }

  function renderSearchHistory() {
    if (data.searchHistory.length === 0) {
      return (
        <EmptyState
          title="No search history yet"
          message="Searches you run while signed in will appear here."
        />
      );
    }

    return (
      <div className="space-y-3">
        {data.searchHistory.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-950">{item.query}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {startModeLabels.get(item.startMode) ?? item.startMode}
                </p>
                <p className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500">
                  <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                  {formatTimestamp(item.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void deleteSearchHistoryItem(item.id, "search");
                }}
                disabled={deletingItemIds.includes(item.id)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                {deletingItemIds.includes(item.id) ? "Deleting..." : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderSavedSources() {
    if (data.savedSources.length === 0) {
      return (
        <EmptyState
          title="No saved sources yet"
          message="Use Save source on a result to add it here."
        />
      );
    }

    return (
      <div className="space-y-3">
        {data.savedSources.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
                <dl className="mt-4 grid gap-4 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Authors</dt>
                    <dd className="mt-1">{formatAuthors(item.authors)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Publication date</dt>
                    <dd className="mt-1">{formatPublicationDate(item.publicationDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Citation count</dt>
                    <dd className="mt-1">{item.citationCount}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  {item.externalUrl ? (
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-semibold text-sky-700 hover:text-sky-900"
                    >
                      Open source
                      <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <span className="text-slate-500">Saved {formatTimestamp(item.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void deleteSavedSourceItem(item.id);
                }}
                disabled={deletingItemIds.includes(item.id)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                {deletingItemIds.includes(item.id) ? "Deleting..." : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderSavedCitations() {
    if (data.savedCitations.length === 0) {
      return (
        <EmptyState
          title="No saved citations yet"
          message="Generate and save a citation from a source detail panel to add it here."
        />
      );
    }

    return (
      <div className="space-y-3">
        {data.savedCitations.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-950">{item.sourceTitle}</h2>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {item.style}
                  </span>
                </div>
                <blockquote className="mt-4 border-l-4 border-slate-300 pl-4 text-sm leading-6 text-slate-800">
                  {item.citationText}
                </blockquote>
                <p className="mt-4 text-xs text-slate-500">Saved {formatTimestamp(item.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void deleteSavedCitationItem(item.id);
                }}
                disabled={deletingItemIds.includes(item.id)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                {deletingItemIds.includes(item.id) ? "Deleting..." : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderEnhancedQueries() {
    if (data.enhancedQueries.length === 0) {
      return (
        <EmptyState
          title="No enhanced query history yet"
          message="Research-plan work you save while signed in will appear here."
        />
      );
    }

    return (
      <div className="space-y-3">
        {data.enhancedQueries.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase text-slate-500">Original query</p>
                <h2 className="mt-1 text-base font-semibold text-slate-950">{item.originalQuery}</h2>
                <dl className="mt-4 grid gap-4 text-sm text-slate-700 lg:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Refined question</dt>
                    <dd className="mt-1">{item.refinedQuestion || "No refined question saved."}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Selected query</dt>
                    <dd className="mt-1">{item.selectedQuery || "No selected query saved."}</dd>
                  </div>
                </dl>
                {item.suggestedQueries.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.suggestedQueries.map((suggestion) => (
                      <span
                        key={suggestion}
                        className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                      >
                        {suggestion}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-4 text-xs text-slate-500">Saved {formatTimestamp(item.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void deleteSearchHistoryItem(item.id, "enhanced");
                }}
                disabled={deletingItemIds.includes(item.id)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                {deletingItemIds.includes(item.id) ? "Deleting..." : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderSectionContent() {
    if (section === "overview") {
      return renderOverview();
    }

    if (section === "search") {
      return renderSearchHistory();
    }

    if (section === "sources") {
      return renderSavedSources();
    }

    if (section === "citations") {
      return renderSavedCitations();
    }

    return renderEnhancedQueries();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={config.backHref}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          {config.backLabel}
        </Link>

        {status === "authenticated" ? (
          <button
            type="button"
            onClick={() => {
              void loadSavedData();
            }}
            disabled={isLoading}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-slate-900 text-white">
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved data</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                {config.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{config.description}</p>
            </div>
          </div>

          {section !== "overview" && status === "authenticated" ? (
            <button
              type="button"
              onClick={() => {
                void clearCurrentSection();
              }}
              disabled={isClearing || currentItems.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {isClearing ? "Clearing..." : "Clear section"}
            </button>
          ) : null}
        </div>
      </section>

      {status === "loading" || isLoading ? (
        <LoadingState title="Loading saved history" message="Restoring your saved data." />
      ) : null}

      {status === "unauthenticated" ? (
        <EmptyState
          title="Sign in to use saved history"
          message="Open the account menu in the header to log in or create an account."
        />
      ) : null}

      {error ? (
        <ErrorState
          title="Saved history unavailable"
          message={error}
          actionLabel="Retry"
          onAction={() => {
            void loadSavedData();
          }}
        />
      ) : null}

      {status === "authenticated" && !isLoading && !error ? renderSectionContent() : null}
    </main>
  );
}
