"use client";

import { FormEvent, useMemo, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/async-state";
import {
  CITATION_STYLE_VALUES,
  START_MODES,
  START_MODE_VALUES,
  type CitationStyle,
  type StartMode,
} from "@/lib/constants";
import type { Source } from "@/types/domain";

interface SearchResponse {
  ok: boolean;
  data?: Source[];
  error?: {
    code: string;
    message: string;
  };
}

interface CitationResponse {
  ok: boolean;
  data?: {
    citationText: string;
    style: CitationStyle;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface BatchCitationItem {
  sourceId: string;
  sourceTitle: string;
  citationText: string;
}

const MODE_HELP: Record<StartMode, string> = {
  "regular-query": "Search for sources directly by topic.",
  "query-to-research-plan":
    "Start with a topic. In a later step, this mode will suggest refined research queries.",
  "claim-to-source":
    "Start from a claim or thesis statement. In a later step, this mode will rank source matches.",
};

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

function getKeywordsFromTitle(title: string) {
  const stopWords = new Set([
    "the",
    "and",
    "from",
    "with",
    "into",
    "that",
    "this",
    "using",
    "study",
    "analysis",
    "effects",
  ]);

  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  return Array.from(new Set(words)).slice(0, 2);
}

function buildMetadataSummary(source: Source) {
  const keywords = getKeywordsFromTitle(source.title);
  const keywordText =
    keywords.length > 0 ? keywords.join(", ") : "the topic described in the source title";

  return `This source appears to discuss ${source.title}. It is likely relevant to your search because it covers ${keywordText}.`;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(START_MODE_VALUES[0]);
  const [results, setResults] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("MLA");
  const [citationText, setCitationText] = useState("");
  const [citationError, setCitationError] = useState<string | null>(null);
  const [isCitationLoading, setIsCitationLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [batchCitations, setBatchCitations] = useState<BatchCitationItem[]>([]);
  const [isBatchCitationLoading, setIsBatchCitationLoading] = useState(false);
  const [batchCitationError, setBatchCitationError] = useState<string | null>(null);
  const [batchCopyStatus, setBatchCopyStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );

  const modeHint = useMemo(() => MODE_HELP[startMode], [startMode]);
  const selectedSource = useMemo(
    () => results.find((source) => source.id === selectedSourceId) ?? null,
    [results, selectedSourceId]
  );
  const selectedSources = useMemo(
    () => results.filter((source) => selectedSourceIds.includes(source.id)),
    [results, selectedSourceIds]
  );

  async function runSearch() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setErrorMessage("Enter a topic or claim before searching.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setHasSearched(true);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`);
      const payload = (await response.json()) as SearchResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Search request failed.");
      }

      setResults(payload.data);
      setSelectedSourceId(null);
      setSelectedSourceIds([]);
      setCitationText("");
      setCitationError(null);
      setCopyStatus("idle");
      setBatchCitations([]);
      setBatchCitationError(null);
      setBatchCopyStatus("idle");
    } catch (error) {
      setResults([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete search right now. Please retry."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  async function generateCitation() {
    if (!selectedSource) {
      return;
    }

    setIsCitationLoading(true);
    setCitationError(null);
    setCopyStatus("idle");

    try {
      const response = await fetch("/api/citation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: selectedSource,
          style: citationStyle,
        }),
      });

      const payload = (await response.json()) as CitationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Citation generation failed.");
      }

      setCitationText(payload.data.citationText);
    } catch (error) {
      setCitationText("");
      setCitationError(
        error instanceof Error ? error.message : "Citation generation failed. Please retry."
      );
    } finally {
      setIsCitationLoading(false);
    }
  }

  async function copyCitation() {
    if (!citationText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(citationText);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }

  function toggleSourceSelection(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    );
  }

  async function generateBatchCitations() {
    if (selectedSources.length === 0) {
      setBatchCitationError("Select at least one source first.");
      return;
    }

    setIsBatchCitationLoading(true);
    setBatchCitationError(null);
    setBatchCopyStatus("idle");

    try {
      const citationPromises = selectedSources.map(async (source) => {
        const response = await fetch("/api/citation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source,
            style: citationStyle,
          }),
        });

        const payload = (await response.json()) as CitationResponse;
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(
            payload.error?.message || `Citation generation failed for ${source.title}.`
          );
        }

        return {
          sourceId: source.id,
          sourceTitle: source.title,
          citationText: payload.data.citationText,
        } satisfies BatchCitationItem;
      });

      const items = await Promise.all(citationPromises);
      setBatchCitations(items);
    } catch (error) {
      setBatchCitations([]);
      setBatchCitationError(
        error instanceof Error
          ? error.message
          : "Failed to generate citation list. Please retry."
      );
    } finally {
      setIsBatchCitationLoading(false);
    }
  }

  async function copyBatchCitationList() {
    if (batchCitations.length === 0) {
      return;
    }

    const content = batchCitations
      .map((item, index) => `${index + 1}. ${item.citationText}`)
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(content);
      setBatchCopyStatus("success");
    } catch {
      setBatchCopyStatus("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          AI Citation Finder &amp; Generator
        </h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          Discover credible academic sources with OpenAlex, then open a source
          to summarize and cite.
        </p>

        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Start mode</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-required>
              {START_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300"
                >
                  <input
                    type="radio"
                    name="startMode"
                    value={mode.value}
                    checked={startMode === mode.value}
                    onChange={() => setStartMode(mode.value)}
                    className="mt-1 h-4 w-4"
                    required
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{mode.label}</span>
                    <span className="mt-1 block text-xs text-slate-600">{mode.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="query" className="block text-sm font-semibold text-slate-900">
              {startMode === "claim-to-source" ? "Claim or thesis" : "Topic"}
            </label>
            <p className="mt-1 text-xs text-slate-600">{modeHint}</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="query"
                name="query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  startMode === "claim-to-source"
                    ? "Example: Remote work improves software team productivity"
                    : "Example: effects of sleep deprivation on memory"
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-sky-500 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? "Searching..." : "Search"}
              </button>
            </div>
          </div>
        </form>
      </section>

      {isLoading ? (
        <LoadingState
          title="Searching OpenAlex"
          message="Finding relevant academic sources for your query."
        />
      ) : null}

      {!isLoading && errorMessage ? (
        <ErrorState
          title="Search unavailable"
          message={errorMessage}
          actionLabel="Retry"
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}

      {!isLoading && !errorMessage && hasSearched && results.length === 0 ? (
        <EmptyState
          title="No sources found"
          message="Try broader terms, fewer keywords, or a more general phrasing of your topic."
          actionLabel="Search again"
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}

      {!isLoading && !errorMessage && results.length > 0 ? (
        <section className="grid gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-700">
                Selected sources: <span className="font-semibold text-slate-900">{selectedSourceIds.length}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSourceIds(results.map((source) => source.id))}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSourceIds([])}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void generateBatchCitations();
                  }}
                  disabled={isBatchCitationLoading}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isBatchCitationLoading ? "Generating list..." : "Generate citation list"}
                </button>
              </div>
            </div>

            {batchCitationError ? (
              <p className="mt-3 text-sm text-rose-700">{batchCitationError}</p>
            ) : null}

            {batchCitations.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Citation list ({citationStyle})
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-800">
                  {batchCitations.map((item) => (
                    <li key={item.sourceId}>
                      <p className="font-semibold text-slate-900">{item.sourceTitle}</p>
                      <p>{item.citationText}</p>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => {
                    void copyBatchCitationList();
                  }}
                  className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Copy full citation list
                </button>
                {batchCopyStatus === "success" ? (
                  <p className="mt-2 text-xs text-emerald-700">Citation list copied.</p>
                ) : null}
                {batchCopyStatus === "error" ? (
                  <p className="mt-2 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {results.map((source) => (
            <article
              key={source.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{source.title}</h2>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    className="h-4 w-4"
                  />
                  Select
                </label>
              </div>
              <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-slate-900">Authors</dt>
                  <dd>{formatAuthors(source.authors)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Publication date</dt>
                  <dd>{formatPublicationDate(source.publicationDate)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">Citation count</dt>
                  <dd>{source.citationCount}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">External link</dt>
                  <dd>
                    {source.externalUrl ? (
                      <a
                        href={source.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
                      >
                        Open source
                      </a>
                    ) : (
                      <span>Unavailable</span>
                    )}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  setSelectedSourceId((current) => (current === source.id ? null : source.id));
                  setCitationStyle("MLA");
                  setCitationText("");
                  setCitationError(null);
                  setCopyStatus("idle");
                }}
                className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                aria-pressed={selectedSourceId === source.id}
              >
                {selectedSourceId === source.id ? "Close details" : "Open details"}
              </button>

              {selectedSourceId === source.id ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-base font-semibold text-slate-900">Source detail</h3>
                  <p className="mt-2 text-sm text-slate-700">{buildMetadataSummary(source)}</p>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label
                        className="block text-sm font-semibold text-slate-900"
                        htmlFor={`citation-style-${source.id}`}
                      >
                        Citation style
                        <select
                          id={`citation-style-${source.id}`}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                          value={citationStyle}
                          onChange={(event) => setCitationStyle(event.target.value as CitationStyle)}
                        >
                          {CITATION_STYLE_VALUES.map((style) => (
                            <option key={style} value={style}>
                              {style}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          void generateCitation();
                        }}
                        disabled={isCitationLoading}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isCitationLoading ? "Generating..." : "Generate citation"}
                      </button>
                    </div>

                    {citationError ? (
                      <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        <p>{citationError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void generateCitation();
                          }}
                          className="mt-2 rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
                        >
                          Retry citation
                        </button>
                      </div>
                    ) : null}

                    {citationText ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Style: {citationStyle}
                        </p>
                        <p className="mt-2 text-sm text-slate-800">{citationText}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void copyCitation();
                          }}
                          className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                        >
                          Copy citation
                        </button>
                        {copyStatus === "success" ? (
                          <p className="mt-2 text-xs text-emerald-700">Copied to clipboard.</p>
                        ) : null}
                        {copyStatus === "error" ? (
                          <p className="mt-2 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
