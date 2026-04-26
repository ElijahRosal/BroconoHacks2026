"use client";

import { FormEvent, useMemo, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/async-state";
import { START_MODES, START_MODE_VALUES, type StartMode } from "@/lib/constants";
import type { Source } from "@/types/domain";

interface SearchResponse {
  ok: boolean;
  data?: Source[];
  error?: {
    code: string;
    message: string;
  };
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(START_MODE_VALUES[0]);
  const [results, setResults] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const modeHint = useMemo(() => MODE_HELP[startMode], [startMode]);

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
          {results.map((source) => (
            <article
              key={source.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-slate-900">{source.title}</h2>
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
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
