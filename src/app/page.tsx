"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  ListChecks,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/async-state";
import {
  CITATION_STYLE_VALUES,
  START_MODES,
  START_MODE_VALUES,
  type CitationStyle,
  type StartMode,
} from "@/lib/constants";
import type {
  ClaimMatch,
  ClaimMatchSearchResponse,
  SavedCitation,
  SavedSource,
  Source,
} from "@/types/domain";

interface PagedSearchResponse {
  ok: boolean;
  data?: {
    items: Source[];
    page: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface ResearchPlanResponseWrapper {
  ok: boolean;
  data?: {
    refinedQuestion: string;
    suggestedQueries: string[];
    keywords: string[];
    synonyms: string[];
  };
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

interface SourceSummaryResponse {
  ok: boolean;
  data?: {
    summary: string;
    provider: "ai" | "fallback";
    usedFallback: boolean;
    abstractSource?: string;
    warning?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedSourcesResponse {
  ok: boolean;
  data?: {
    items: SavedSource[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedSourceMutationResponse {
  ok: boolean;
  data?: {
    item: SavedSource;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface SavedCitationMutationResponse {
  ok: boolean;
  data?: {
    item: SavedCitation;
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
  style: CitationStyle;
}

interface GeneratedCitation {
  citationText: string;
  style: CitationStyle;
}

interface ResearchPlanState {
  originalQuery: string;
  refinedQuestion: string;
  suggestedQueries: string[];
  keywords: string[];
  synonyms: string[];
}

const MODE_HELP: Record<StartMode, string> = {
  "regular-query": "Search for sources directly by topic.",
  "query-to-research-plan":
    "Turn a broad topic into focused research queries before searching.",
  "claim-to-source":
    "Rank sources against a claim or thesis statement.",
};

const MODE_ICON_MAP: Record<StartMode, typeof Search> = {
  "regular-query": Search,
  "query-to-research-plan": Sparkles,
  "claim-to-source": Target,
};

const DEFAULT_RESULTS_LIMIT = 15;
const RESULT_SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "citation-count", label: "Citation count" },
  { value: "publication-date", label: "Publication date" },
] as const;

type ResultSortOption = (typeof RESULT_SORT_OPTIONS)[number]["value"];

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

function buildFallbackSummary(source: Source) {
  const keywords = getKeywordsFromTitle(source.title);
  const keywordText =
    keywords.length > 0 ? keywords.join(", ") : "the topic described in the source title";

  return `This source appears to discuss ${source.title}. It is likely relevant to your search because it covers ${keywordText}.`;
}

function normalizeResultsLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_RESULTS_LIMIT;
  }

  return Math.trunc(value);
}

export default function Home() {
  const { status: sessionStatus } = useSession();
  const [query, setQuery] = useState("");
  const [startMode, setStartMode] = useState<StartMode>(START_MODE_VALUES[0]);
  const [results, setResults] = useState<Source[]>([]);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsLimit, setResultsLimit] = useState(DEFAULT_RESULTS_LIMIT);
  const [resultsTotalCount, setResultsTotalCount] = useState(0);
  const [resultsHasMore, setResultsHasMore] = useState(false);
  const [resultSort, setResultSort] = useState<ResultSortOption>("recommended");
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isClaimMatching, setIsClaimMatching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [planErrorMessage, setPlanErrorMessage] = useState<string | null>(null);
  const [claimMatchError, setClaimMatchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedSourceIds, setExpandedSourceIds] = useState<string[]>([]);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("MLA");
  const [citationTextsBySource, setCitationTextsBySource] = useState<
    Record<string, GeneratedCitation>
  >({});
  const [citationErrorsBySource, setCitationErrorsBySource] = useState<Record<string, string>>({});
  const [citationLoadingSourceId, setCitationLoadingSourceId] = useState<string | null>(null);
  const [copyStatusBySource, setCopyStatusBySource] = useState<
    Record<string, "idle" | "success" | "error">
  >({});
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [batchCitations, setBatchCitations] = useState<BatchCitationItem[]>([]);
  const [isBatchCitationLoading, setIsBatchCitationLoading] = useState(false);
  const [isBatchCitationSaving, setIsBatchCitationSaving] = useState(false);
  const [batchCitationError, setBatchCitationError] = useState<string | null>(null);
  const [batchCopyStatus, setBatchCopyStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );
  const [batchSaveStatus, setBatchSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [batchSaveError, setBatchSaveError] = useState<string | null>(null);
  const [savedSources, setSavedSources] = useState<SavedSource[]>([]);
  const [accountDataError, setAccountDataError] = useState<string | null>(null);
  const [savingSourceIds, setSavingSourceIds] = useState<string[]>([]);
  const [savingCitationSourceIds, setSavingCitationSourceIds] = useState<string[]>([]);
  const [researchPlan, setResearchPlan] = useState<ResearchPlanState | null>(null);
  const [pendingResearchPlanQuery, setPendingResearchPlanQuery] = useState<string>("");
  const [claimMatches, setClaimMatches] = useState<ClaimMatch[]>([]);
  const [claimRefinedQuestion, setClaimRefinedQuestion] = useState<string>("");
  const [claimRetrievalQueries, setClaimRetrievalQueries] = useState<string[]>([]);
  const [claimKeywords, setClaimKeywords] = useState<string[]>([]);
  const [summariesBySource, setSummariesBySource] = useState<Record<string, string>>({});
  const [summaryLoadingBySource, setSummaryLoadingBySource] = useState<Record<string, boolean>>({});
  const [summaryErrorsBySource, setSummaryErrorsBySource] = useState<Record<string, string>>({});
  const queryRef = useRef(query);
  const searchAbortRef = useRef<AbortController | null>(null);
  const claimAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const lastSubmittedSignatureRef = useRef<string>("");

  const modeHint = useMemo(() => MODE_HELP[startMode], [startMode]);
  const claimMatchBySourceId = useMemo(
    () => new Map(claimMatches.map((match) => [match.sourceId, match])),
    [claimMatches]
  );
  const savedSourceOpenAlexIds = useMemo(
    () => new Set(savedSources.map((item) => item.openAlexId)),
    [savedSources]
  );
  const totalResultPages = useMemo(() => {
    const safeLimit = normalizeResultsLimit(resultsLimit);
    const totalResults = resultsTotalCount > 0 ? resultsTotalCount : results.length;
    const pages = Math.ceil(totalResults / safeLimit);

    return Number.isFinite(pages) && pages > 0 ? pages : 1;
  }, [resultsLimit, results.length, resultsTotalCount]);

  const sortedResults = useMemo(() => {
    const filteredResults = openAccessOnly
      ? results.filter((source) => source.accessType === "free")
      : results;

    const sourceOrder = new Map(results.map((source, index) => [source.id, index]));

    const parsedPublicationDate = (value: string) => {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const sortedItems = [...filteredResults].sort((left, right) => {
      if (resultSort === "recommended") {
        return (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
      }

      if (resultSort === "citation-count") {
        if (left.citationCount !== right.citationCount) {
          return right.citationCount - left.citationCount;
        }
      }

      if (resultSort === "publication-date") {
        const dateDiff = parsedPublicationDate(right.publicationDate) - parsedPublicationDate(left.publicationDate);
        if (dateDiff !== 0) {
          return dateDiff;
        }
      }

      return (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
    });

    return sortedItems;
  }, [openAccessOnly, resultSort, results]);

  const selectedSources = useMemo(
    () => sortedResults.filter((source) => selectedSourceIds.includes(source.id)),
    [selectedSourceIds, sortedResults]
  );
  const canGoPrevious = resultsPage > 1;
  const canGoNext = resultsHasMore || resultsPage < totalResultPages;

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    lastSubmittedSignatureRef.current = `${startMode}::${queryRef.current.trim()}`;
  }, [startMode]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      setSavedSources([]);
      setAccountDataError(null);
      return;
    }

    void loadSavedSources();
  }, [sessionStatus]);

  useEffect(() => {
    if (startMode !== "query-to-research-plan") {
      setResearchPlan(null);
      setPlanErrorMessage(null);
      setPendingResearchPlanQuery("");
    }

    if (startMode !== "claim-to-source") {
      setClaimMatches([]);
      setClaimRefinedQuestion("");
      setClaimRetrievalQueries([]);
      setClaimKeywords([]);
      setClaimMatchError(null);
    }

    setResultsPage(1);
  }, [startMode]);

  async function loadSavedSources() {
    setAccountDataError(null);

    try {
      const savedSourcesResponse = await fetch("/api/saved-sources");
      const savedSourcesPayload = (await savedSourcesResponse.json()) as SavedSourcesResponse;

      if (
        !savedSourcesResponse.ok ||
        !savedSourcesPayload.ok ||
        !savedSourcesPayload.data
      ) {
        throw new Error(
          savedSourcesPayload.error?.message ||
            "Unable to load saved sources."
        );
      }

      setSavedSources(savedSourcesPayload.data.items);
    } catch (error) {
      setAccountDataError(
        error instanceof Error ? error.message : "Unable to load saved sources right now."
      );
    }
  }

  async function saveSourceForUser(source: Source) {
    if (sessionStatus !== "authenticated") {
      return;
    }

    setSavingSourceIds((current) => [...current, source.id]);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/saved-sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
      });

      const payload = (await response.json()) as SavedSourceMutationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Unable to save source.");
      }

      const savedItem = payload.data.item;

      setSavedSources((current) => {
        const withoutExisting = current.filter(
          (item) => item.openAlexId !== savedItem.openAlexId
        );
        return [savedItem, ...withoutExisting];
      });
      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to save source.");
    } finally {
      setSavingSourceIds((current) => current.filter((id) => id !== source.id));
    }
  }

  async function saveCitationForUser(source: Source) {
    if (sessionStatus !== "authenticated") {
      return;
    }

    const citation = citationTextsBySource[source.id];
    if (!citation?.citationText) {
      setAccountDataError("Generate a citation before saving it.");
      return;
    }

    setSavingCitationSourceIds((current) => [...current, source.id]);
    setAccountDataError(null);

    try {
      const response = await fetch("/api/saved-citations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceId: source.id,
          sourceTitle: source.title,
          style: citation.style,
          citationText: citation.citationText,
        }),
      });

      const payload = (await response.json()) as SavedCitationMutationResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Unable to save citation.");
      }

      window.dispatchEvent(new Event("saved-data-changed"));
    } catch (error) {
      setAccountDataError(error instanceof Error ? error.message : "Unable to save citation.");
    } finally {
      setSavingCitationSourceIds((current) => current.filter((id) => id !== source.id));
    }
  }

  const performSearch = useCallback(async (
    searchQuery: string,
    page = 1,
    limit = resultsLimit
  ) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setErrorMessage("Enter a topic or claim before searching.");
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const signature = `${startMode}::${trimmedQuery}`;
    lastSubmittedSignatureRef.current = signature;

    setIsLoading(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setResearchPlan(null);
    setHasSearched(true);
    setResultsPage(page);
    setResultsLimit(limit);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}&startMode=${encodeURIComponent(startMode)}&page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}&openAccessOnly=${encodeURIComponent(String(openAccessOnly))}`,
        {
          signal: controller.signal,
        }
      );
      const payload = (await response.json()) as PagedSearchResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Search request failed.");
      }

      setResults(payload.data.items);
      setResultsPage(payload.data.page);
      setResultsLimit(normalizeResultsLimit(payload.data.limit));
      setResultsTotalCount(payload.data.totalCount);
      setResultsHasMore(payload.data.hasMore);
      setExpandedSourceIds([]);
      setSelectedSourceIds([]);
      setCitationTextsBySource({});
      setCitationErrorsBySource({});
      setCopyStatusBySource({});
      setCitationLoadingSourceId(null);
      setSummariesBySource({});
      setSummaryLoadingBySource({});
      setSummaryErrorsBySource({});
      setBatchCitations([]);
      setBatchCitationError(null);
      setBatchCopyStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setResults([]);
      setResultsTotalCount(0);
      setResultsHasMore(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete search right now. Please retry."
      );
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [openAccessOnly, resultsLimit, startMode]);

  const requestClaimMatches = useCallback(async (
    trimmedClaim: string,
    page = 1,
    limit = resultsLimit
  ) => {
    if (!trimmedClaim) {
      setErrorMessage("Enter a claim before matching sources.");
      return;
    }

    claimAbortRef.current?.abort();
    const controller = new AbortController();
    claimAbortRef.current = controller;

    const signature = `${startMode}::${trimmedClaim}`;
    lastSubmittedSignatureRef.current = signature;

    setIsClaimMatching(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    setClaimMatchError(null);
    setHasSearched(true);
    setResultsPage(page);
    setResultsLimit(limit);

    try {
      const response = await fetch(
        `/api/claim-match?page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}&openAccessOnly=${encodeURIComponent(String(openAccessOnly))}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({ claim: trimmedClaim }),
        }
      );

      const payload = (await response.json()) as {
        ok: boolean;
        data?: ClaimMatchSearchResponse;
        error?: {
          code: string;
          message: string;
        };
      };

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Claim matching failed.");
      }

      setResults(payload.data.sources);
      setResultsPage(payload.data.page);
      setResultsLimit(normalizeResultsLimit(payload.data.limit));
      setResultsTotalCount(payload.data.totalResults);
      setResultsHasMore(payload.data.hasMore);
      setClaimMatches(payload.data.matches);
      setClaimRefinedQuestion(payload.data.refinedQuestion);
      setClaimRetrievalQueries(payload.data.retrievalQueries);
      setClaimKeywords(payload.data.keywords);
      setClaimMatchError(payload.data.matchError ?? null);
      setExpandedSourceIds([]);
      setSelectedSourceIds([]);
      setCitationTextsBySource({});
      setCitationErrorsBySource({});
      setCopyStatusBySource({});
      setCitationLoadingSourceId(null);
      setSummariesBySource({});
      setSummaryLoadingBySource({});
      setSummaryErrorsBySource({});
      setBatchCitations([]);
      setBatchCitationError(null);
      setBatchCopyStatus("idle");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setClaimMatches([]);
      setClaimRefinedQuestion("");
      setClaimRetrievalQueries([]);
      setClaimKeywords([]);
      setClaimMatchError(
        error instanceof Error
          ? `${error.message} Falling back to a standard search.`
          : "Unable to rank claim matches right now. Falling back to a standard search."
      );
      await performSearch(trimmedClaim, page, limit);
    } finally {
      if (claimAbortRef.current === controller) {
        claimAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsClaimMatching(false);
      }
    }
  }, [openAccessOnly, performSearch, resultsLimit, startMode]);

  async function rerunCurrentQuery(page = resultsPage, limit = resultsLimit) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    if (startMode === "query-to-research-plan") {
      await requestResearchPlan(trimmedQuery);
      return;
    }

    if (startMode === "claim-to-source") {
      await requestClaimMatches(trimmedQuery, page, limit);
      return;
    }

    await performSearch(trimmedQuery, page, limit);
  }

  async function runSearch() {
    await rerunCurrentQuery(1, resultsLimit);
  }

  async function requestResearchPlan(trimmedQuery: string) {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;

    setIsPlanning(true);
    setErrorMessage(null);
    setPlanErrorMessage(null);
    setHasSearched(true);

    try {
      const response = await fetch("/api/research-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({ query: trimmedQuery, openAccessOnly }),
      });

      const payload = (await response.json()) as ResearchPlanResponseWrapper;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Research plan failed.");
      }

      setResearchPlan({
        originalQuery: trimmedQuery,
        refinedQuestion: payload.data.refinedQuestion,
        suggestedQueries: payload.data.suggestedQueries,
        keywords: payload.data.keywords,
        synonyms: payload.data.synonyms,
      });
      setPendingResearchPlanQuery(trimmedQuery);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setResearchPlan(null);
      setPlanErrorMessage(
        error instanceof Error ? error.message : "Unable to build a research plan right now."
      );
      await performSearch(trimmedQuery);
    } finally {
      if (planAbortRef.current === controller) {
        planAbortRef.current = null;
      }

      if (!controller.signal.aborted) {
        setIsPlanning(false);
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();
    if (startMode === "query-to-research-plan") {
      await requestResearchPlan(trimmedQuery);
      return;
    }

    if (startMode === "claim-to-source") {
      await requestClaimMatches(trimmedQuery, 1, resultsLimit);
      return;
    }

    await performSearch(trimmedQuery, 1, resultsLimit);
  }

  async function searchWithSuggestion(suggestion: string) {
    setQuery(suggestion);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    await performSearch(suggestion, 1, resultsLimit);
  }

  async function searchWithOriginalResearchQuery() {
    const originalQuery = pendingResearchPlanQuery || query;
    setQuery(originalQuery);
    setResearchPlan(null);
    setPendingResearchPlanQuery("");
    await performSearch(originalQuery, 1, resultsLimit);
  }

  function changeCitationStyle(nextStyle: CitationStyle) {
    setCitationStyle(nextStyle);
    setCitationTextsBySource({});
    setCitationErrorsBySource({});
    setCopyStatusBySource({});
    setBatchCitations([]);
    setBatchCitationError(null);
    setBatchCopyStatus("idle");
    setBatchSaveStatus("idle");
    setBatchSaveError(null);
  }

  async function generateCitationForSource(source: Source) {
    setCitationLoadingSourceId(source.id);
    setCitationErrorsBySource((current) => ({ ...current, [source.id]: "" }));
    setCopyStatusBySource((current) => ({ ...current, [source.id]: "idle" }));

    try {
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
        throw new Error(payload.error?.message || "Citation generation failed.");
      }

      const citationData = payload.data;
      setCitationTextsBySource((current) => ({
        ...current,
        [source.id]: {
          citationText: citationData.citationText,
          style: citationData.style,
        },
      }));
    } catch (error) {
      setCitationTextsBySource((current) => {
        const rest = { ...current };
        delete rest[source.id];
        return rest;
      });
      setCitationErrorsBySource((current) => ({
        ...current,
        [source.id]:
          error instanceof Error ? error.message : "Citation generation failed. Please retry.",
      }));
    } finally {
      setCitationLoadingSourceId(null);
    }
  }

  async function copyCitationForSource(sourceId: string) {
    const citationText = citationTextsBySource[sourceId]?.citationText ?? "";
    if (!citationText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(citationText);
      setCopyStatusBySource((current) => ({ ...current, [sourceId]: "success" }));
    } catch {
      setCopyStatusBySource((current) => ({ ...current, [sourceId]: "error" }));
    }
  }

  async function generateSummaryForSource(source: Source, forceRefresh = false) {
    if (!forceRefresh && summariesBySource[source.id]) {
      return;
    }

    setSummaryLoadingBySource((current) => ({
      ...current,
      [source.id]: true,
    }));
    setSummaryErrorsBySource((current) => ({
      ...current,
      [source.id]: "",
    }));

    try {
      const response = await fetch("/api/source-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
      });

      const payload = (await response.json()) as SourceSummaryResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message || "Unable to generate source summary.");
      }

      setSummariesBySource((current) => ({
        ...current,
        [source.id]: payload.data?.summary || buildFallbackSummary(source),
      }));
      setSummaryErrorsBySource((current) => ({
        ...current,
        [source.id]: payload.data?.usedFallback ? payload.data.warning || "Using metadata-only summary." : "",
      }));
    } catch (error) {
      setSummariesBySource((current) => ({
        ...current,
        [source.id]: buildFallbackSummary(source),
      }));
      setSummaryErrorsBySource((current) => ({
        ...current,
        [source.id]: error instanceof Error ? error.message : "Unable to generate AI summary.",
      }));
    } finally {
      setSummaryLoadingBySource((current) => ({
        ...current,
        [source.id]: false,
      }));
    }
  }

  function toggleSourceDetails(source: Source) {
    const isExpanded = expandedSourceIds.includes(source.id);
    if (!isExpanded) {
      void generateSummaryForSource(source);
    }

    setExpandedSourceIds((current) =>
      current.includes(source.id)
        ? current.filter((id) => id !== source.id)
        : [...current, source.id]
    );
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
    setBatchSaveStatus("idle");
    setBatchSaveError(null);

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
          style: payload.data.style,
        } satisfies BatchCitationItem;
      });

      const items = await Promise.all(citationPromises);
      const sortedItems = [...items].sort((a, b) =>
        a.citationText.localeCompare(b.citationText, undefined, { sensitivity: "base" })
      );
      setBatchCitations(sortedItems);
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

  async function saveBatchCitationsForUser() {
    if (sessionStatus !== "authenticated") {
      return;
    }

    if (batchCitations.length === 0) {
      setBatchSaveError("Generate a citation list before saving.");
      setBatchSaveStatus("error");
      return;
    }

    setIsBatchCitationSaving(true);
    setBatchSaveStatus("idle");
    setBatchSaveError(null);
    setAccountDataError(null);

    try {
      await Promise.all(
        batchCitations.map(async (item) => {
          const response = await fetch("/api/saved-citations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sourceId: item.sourceId,
              sourceTitle: item.sourceTitle,
              style: item.style,
              citationText: item.citationText,
            }),
          });

          const payload = (await response.json()) as SavedCitationMutationResponse;
          if (!response.ok || !payload.ok || !payload.data) {
            throw new Error(payload.error?.message || "Unable to save citation list.");
          }

          return payload.data.item;
        })
      );

      window.dispatchEvent(new Event("saved-data-changed"));
      setBatchSaveStatus("success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save citation list right now.";
      setBatchSaveStatus("error");
      setBatchSaveError(message);
      setAccountDataError(message);
    } finally {
      setIsBatchCitationSaving(false);
    }
  }

  async function copyBatchCitationList() {
    if (batchCitations.length === 0) {
      return;
    }

    const content = batchCitations.map((item) => item.citationText).join("\n\n");

    try {
      await navigator.clipboard.writeText(content);
      setBatchCopyStatus("success");
    } catch {
      setBatchCopyStatus("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Citeable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
            Search academic sources, compare results, and generate citation-ready references.
          </p>
        </div>

        <form className="mx-auto mt-8 max-w-4xl space-y-7" onSubmit={onSubmit}>
          <fieldset>
            <legend className="mx-auto text-center text-sm font-semibold text-slate-950">
              Start mode
            </legend>
            <div className="mt-4 grid gap-3 md:grid-cols-3" role="radiogroup" aria-required>
              {START_MODES.map((mode) => {
                const ModeIcon = MODE_ICON_MAP[mode.value];
                const isSelected = startMode === mode.value;

                return (
                  <label
                    key={mode.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-950 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="startMode"
                      value={mode.value}
                      checked={isSelected}
                      onChange={() => setStartMode(mode.value)}
                      className="sr-only"
                      required
                    />
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
                        isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      <ModeIcon aria-hidden className="h-5 w-5" />
                    </span>
                    <span className="text-left">
                      <span className="block text-sm font-semibold">{mode.label}</span>
                      <span
                        className={`mt-1 block text-xs leading-5 ${
                          isSelected ? "text-slate-200" : "text-slate-600"
                        }`}
                      >
                        {mode.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="text-center">
            <label htmlFor="query" className="text-sm font-semibold text-slate-950">
              {startMode === "claim-to-source" ? "Claim or thesis" : "Topic"}
            </label>
            <p className="mt-1 text-xs text-slate-600">{modeHint}</p>
            <div className="mx-auto mt-4 flex max-w-3xl flex-col gap-3 sm:flex-row">
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
                className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none ring-sky-500 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={isLoading || isPlanning || isClaimMatching}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Search aria-hidden className="h-4 w-4" />
                {isLoading
                  ? "Searching..."
                  : isPlanning
                    ? "Planning..."
                    : isClaimMatching
                      ? "Matching..."
                      : startMode === "claim-to-source"
                        ? "Match claim"
                        : "Search"}
              </button>
            </div>
          </div>
        </form>
      </section>

      {researchPlan ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Research plan</h2>
              <p className="mt-1 text-sm text-slate-700">
                Review the refined question and pick a suggested search query, or continue with the original query.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void searchWithOriginalResearchQuery();
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Search original query
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Refined question
              </p>
              <p className="mt-2 text-sm text-slate-800">{researchPlan.refinedQuestion}</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Keywords</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {researchPlan.keywords.map((keyword) => (
                  <span key={keyword} className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Synonyms</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {researchPlan.synonyms.map((synonym) => (
                  <span key={synonym} className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                    {synonym}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-sky-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Suggested queries
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {researchPlan.suggestedQueries.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    void searchWithSuggestion(suggestion);
                  }}
                  className="rounded-full border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-600">
            Original query: <span className="font-semibold text-slate-800">{researchPlan.originalQuery}</span>
          </p>
        </section>
      ) : null}

      {planErrorMessage ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm">
          <p className="text-sm font-semibold">Research plan unavailable</p>
          <p className="mt-1 text-sm">{planErrorMessage}</p>
          <p className="mt-2 text-xs">
            The app automatically continued with a standard search so your workflow is not blocked.
          </p>
        </section>
      ) : null}

      {startMode === "claim-to-source" && (claimMatches.length > 0 || claimRetrievalQueries.length > 0 || claimMatchError) ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Claim matches</h2>
              <p className="mt-1 text-sm text-slate-700">
                Ranked sources for the claim you entered. Pick a retrieval query to continue searching.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void requestClaimMatches(query.trim());
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Retry claim matching
            </button>
          </div>

          {claimMatchError ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {claimMatchError}
            </p>
          ) : null}

          {claimRefinedQuestion ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Refined question
              </p>
              <p className="mt-2 text-sm text-slate-800">{claimRefinedQuestion}</p>
            </div>
          ) : null}

          {claimKeywords.length > 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Keywords</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {claimKeywords.map((keyword) => (
                  <span key={keyword} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {claimRetrievalQueries.length > 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Retrieval queries
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {claimRetrievalQueries.map((retrievalQuery) => (
                  <button
                    key={retrievalQuery}
                    type="button"
                    onClick={() => {
                      setQuery(retrievalQuery);
                      void performSearch(retrievalQuery);
                    }}
                    className="rounded-full border border-slate-300 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  >
                    Search: {retrievalQuery}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isLoading || isPlanning || isClaimMatching ? (
        <LoadingState
          title={
            isClaimMatching
              ? "Ranking claim matches"
              : isPlanning
                ? "Building research plan"
                : "Searching OpenAlex"
          }
          message={
            isClaimMatching
              ? "Fetching candidate sources, scoring them against your claim, and keeping the source list usable while the match completes."
              : isPlanning
                ? "Reviewing your topic and preparing a refined search path."
                : "Finding relevant academic sources for your query."
          }
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

      {!isLoading && !errorMessage && hasSearched && sortedResults.length === 0 ? (
        <EmptyState
          title={
            openAccessOnly
              ? "No open access sources on this page"
              : startMode === "claim-to-source"
                ? "No ranked matches found"
                : "No sources found"
          }
          message={
            openAccessOnly
              ? "Try unchecking Open access only, or move to the next page to find more open access sources."
              : startMode === "claim-to-source"
              ? "Try a broader claim, or switch to regular search if you want to browse the wider source list first."
              : "Try broader terms, fewer keywords, or a more general phrasing of your topic."
          }
          actionLabel="Search again"
          onAction={() => {
            void runSearch();
          }}
        />
      ) : null}

      {!isLoading && !errorMessage && sortedResults.length > 0 ? (
        <section className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
                    <ListChecks aria-hidden className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Search results</h2>
                    <p className="text-sm text-slate-600">
                      Page {resultsPage} of {totalResultPages} · {resultsTotalCount || results.length} total results
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-700">
                  Selected sources on this page:{" "}
                  <span className="font-semibold text-slate-950">{selectedSources.length}</span>
                </p>
              </div>

              <div className="flex flex-col gap-3 lg:items-end">
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"
                    htmlFor="results-sort"
                  >
                    <SlidersHorizontal aria-hidden className="h-4 w-4" />
                    Sort by
                  </label>
                  <select
                    id="results-sort"
                    value={resultSort}
                    onChange={(event) => setResultSort(event.target.value as ResultSortOption)}
                    className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none ring-sky-500 focus:ring-2"
                  >
                    {RESULT_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={openAccessOnly}
                      onChange={(event) => setOpenAccessOnly(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Open access only
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => {
                  void rerunCurrentQuery(resultsPage - 1, resultsLimit);
                }}
                disabled={!canGoPrevious || isLoading || isClaimMatching}
                className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
                Previous
              </button>
              <span className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                Results
              </span>
              <button
                type="button"
                onClick={() => {
                  void rerunCurrentQuery(resultsPage + 1, resultsLimit);
                }}
                disabled={!canGoNext || isLoading || isClaimMatching}
                className="inline-flex w-fit items-center gap-2 justify-self-end rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight aria-hidden className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSourceIds(sortedResults.map((source) => source.id))}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  <Check aria-hidden className="h-4 w-4" />
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSourceIds([]);
                    setBatchCitations([]);
                    setBatchCitationError(null);
                    setBatchCopyStatus("idle");
                  }}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  <X aria-hidden className="h-4 w-4" />
                  Clear
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block text-sm font-semibold text-slate-950" htmlFor="batch-citation-style">
                  Citation style
                  <select
                    id="batch-citation-style"
                    className="mt-2 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 outline-none ring-sky-500 focus:ring-2 sm:w-40"
                    value={citationStyle}
                    onChange={(event) => changeCitationStyle(event.target.value as CitationStyle)}
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
                    void generateBatchCitations();
                  }}
                  disabled={isBatchCitationLoading}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <FileText aria-hidden className="h-4 w-4" />
                  {isBatchCitationLoading ? "Generating list..." : `Generate ${citationStyle} list`}
                </button>
              </div>
            </div>

            {accountDataError ? <p className="mt-4 text-sm text-rose-700">{accountDataError}</p> : null}
            {batchCitationError ? <p className="mt-4 text-sm text-rose-700">{batchCitationError}</p> : null}

            {batchCitations.length > 0 ? (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Alphabetical citation list ({batchCitations[0]?.style ?? citationStyle})
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-slate-800">
                  {batchCitations.map((item) => (
                    <p key={item.sourceId} className="break-words [overflow-wrap:anywhere]">
                      {item.citationText}
                    </p>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void copyBatchCitationList();
                    }}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    <Copy aria-hidden className="h-4 w-4" />
                    Copy full citation list
                  </button>
                  {sessionStatus === "authenticated" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void saveBatchCitationsForUser();
                      }}
                      disabled={isBatchCitationSaving}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Save aria-hidden className="h-4 w-4" />
                      {isBatchCitationSaving ? "Saving list..." : "Save citation list"}
                    </button>
                  ) : null}
                </div>
                {batchCopyStatus === "success" ? (
                  <p className="mt-3 text-xs text-emerald-700">Citation list copied.</p>
                ) : null}
                {batchCopyStatus === "error" ? (
                  <p className="mt-3 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                ) : null}
                {batchSaveStatus === "success" ? (
                  <p className="mt-3 text-xs text-emerald-700">Citation list saved to Saved citations.</p>
                ) : null}
                {batchSaveStatus === "error" && batchSaveError ? (
                  <p className="mt-3 text-xs text-rose-700">{batchSaveError}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {sortedResults.map((source) => {
            const generatedCitation = citationTextsBySource[source.id];
            const isExpanded = expandedSourceIds.includes(source.id);
            const isSelected = selectedSourceIds.includes(source.id);
            const isSaved = savedSourceOpenAlexIds.has(source.id);

            return (
              <article
                key={source.id}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-semibold leading-7 text-slate-950">{source.title}</h2>
                    {startMode === "claim-to-source" ? (() => {
                      const claimMatch = claimMatchBySourceId.get(source.id);
                      if (!claimMatch) {
                        return null;
                      }

                      return (
                        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            <span>Claim match</span>
                            <span className="rounded-md bg-white px-2 py-1 normal-case tracking-normal text-slate-800">
                              Score {claimMatch.score.toFixed(0)}
                            </span>
                            <span className="rounded-md bg-white px-2 py-1 normal-case tracking-normal text-slate-800">
                              {claimMatch.confidence}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-800">{claimMatch.rationale}</p>
                        </div>
                      );
                    })() : null}
                  </div>
                  <label className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSourceSelection(source.id)}
                      className="h-4 w-4"
                    />
                    Select
                  </label>
                </div>

                <dl className="mt-5 grid gap-4 border-y border-slate-200 py-5 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Authors</dt>
                    <dd className="mt-1 leading-6">{formatAuthors(source.authors)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publication date</dt>
                    <dd className="mt-1 inline-flex items-center gap-2">
                      <CalendarDays aria-hidden className="h-4 w-4 text-slate-400" />
                      {formatPublicationDate(source.publicationDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Citation count</dt>
                    <dd className="mt-1 font-semibold text-slate-950">{source.citationCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">External link</dt>
                    <dd className="mt-1">
                      {source.externalUrl ? (
                        <a
                          href={source.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-semibold text-sky-700 hover:text-sky-900"
                        >
                          Open source
                          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span>Unavailable</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      toggleSourceDetails(source);
                    }}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                    aria-pressed={isExpanded}
                  >
                    <FileText aria-hidden className="h-4 w-4" />
                    {isExpanded ? "Close details" : "Open details"}
                  </button>

                  {sessionStatus === "authenticated" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void saveSourceForUser(source);
                      }}
                      disabled={savingSourceIds.includes(source.id) || isSaved}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSaved ? (
                        <Check aria-hidden className="h-4 w-4" />
                      ) : (
                        <BookmarkPlus aria-hidden className="h-4 w-4" />
                      )}
                      {savingSourceIds.includes(source.id)
                        ? "Saving source..."
                        : isSaved
                          ? "Source saved"
                          : "Save source"}
                    </button>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5">
                    <h3 className="text-base font-semibold text-slate-950">Source detail</h3>
                    {summaryLoadingBySource[source.id] ? (
                      <p className="mt-2 text-sm leading-6 text-slate-600">Generating AI summary...</p>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        {summariesBySource[source.id] || buildFallbackSummary(source)}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void generateSummaryForSource(source, true);
                        }}
                        disabled={Boolean(summaryLoadingBySource[source.id])}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Regenerate summary
                      </button>
                      {summaryErrorsBySource[source.id] ? (
                        <p className="text-xs text-amber-700">Using fallback summary. {summaryErrorsBySource[source.id]}</p>
                      ) : null}
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <label
                          className="block text-sm font-semibold text-slate-950"
                          htmlFor={`citation-style-${source.id}`}
                        >
                          Citation style
                          <select
                            id={`citation-style-${source.id}`}
                            className="mt-2 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 outline-none ring-sky-500 focus:ring-2 sm:w-48"
                            value={citationStyle}
                            onChange={(event) =>
                              changeCitationStyle(event.target.value as CitationStyle)
                            }
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
                            void generateCitationForSource(source);
                          }}
                          disabled={citationLoadingSourceId === source.id}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <FileText aria-hidden className="h-4 w-4" />
                          {citationLoadingSourceId === source.id
                            ? "Generating..."
                            : `Generate ${citationStyle} citation`}
                        </button>
                      </div>

                      {citationErrorsBySource[source.id] ? (
                        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                          <p>{citationErrorsBySource[source.id]}</p>
                          <button
                            type="button"
                            onClick={() => {
                              void generateCitationForSource(source);
                            }}
                            className="mt-3 rounded-md bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-600"
                          >
                            Retry citation
                          </button>
                        </div>
                      ) : null}

                      {generatedCitation ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Style: {generatedCitation.style}
                          </p>
                          <p className="mt-3 break-words text-sm leading-6 text-slate-800 [overflow-wrap:anywhere]">
                            {generatedCitation.citationText}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void copyCitationForSource(source.id);
                              }}
                              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                            >
                              <Copy aria-hidden className="h-4 w-4" />
                              Copy citation
                            </button>
                            {sessionStatus === "authenticated" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void saveCitationForUser(source);
                                }}
                                disabled={savingCitationSourceIds.includes(source.id)}
                                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <Save aria-hidden className="h-4 w-4" />
                                {savingCitationSourceIds.includes(source.id)
                                  ? "Saving citation..."
                                  : "Save citation"}
                              </button>
                            ) : null}
                          </div>
                          {copyStatusBySource[source.id] === "success" ? (
                            <p className="mt-3 text-xs text-emerald-700">Copied to clipboard.</p>
                          ) : null}
                          {copyStatusBySource[source.id] === "error" ? (
                            <p className="mt-3 text-xs text-rose-700">Copy failed. Please copy manually.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void rerunCurrentQuery(resultsPage - 1, resultsLimit);
                }}
                disabled={!canGoPrevious || isLoading || isClaimMatching}
                className="inline-flex w-fit items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
                Previous
              </button>
              <span className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                Page {resultsPage}
              </span>
              <button
                type="button"
                onClick={() => {
                  void rerunCurrentQuery(resultsPage + 1, resultsLimit);
                }}
                disabled={!canGoNext || isLoading || isClaimMatching}
                className="inline-flex w-fit items-center gap-2 justify-self-end rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
