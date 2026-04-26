import type { Source } from "@/types/domain";

interface OpenAlexSearchOptions {
  page?: number;
  perPage?: number;
  signal?: AbortSignal;
}

interface OpenAlexSearchPageResult {
  items: Source[];
  totalCount: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

interface OpenAlexAuthor {
  author?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexWork {
  id?: string;
  title?: string | null;
  authorships?: OpenAlexAuthor[] | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  relevance_score?: number | null;
  open_access?: {
    is_oa?: boolean | null;
    oa_status?: string | null;
    any_repository_has_fulltext?: boolean | null;
  } | null;
  best_oa_location?: {
    is_oa?: boolean | null;
  } | null;
  primary_location?: {
    is_oa?: boolean | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
  meta?: {
    count?: number | null;
  } | null;
}

interface CacheEntry {
  expiresAt: number;
  value: OpenAlexSearchPageResult;
}

const OPENALEX_CACHE_TTL_MS = 60_000;
const OPENALEX_TIMEOUT_MS = 10_000;
const OPENALEX_RETRY_COUNT = 2;
const openAlexCache = new Map<string, CacheEntry>();

function toUnixDate(date: string): number {
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeExternalUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed && isSafeHttpUrl(trimmed)) {
      return trimmed;
    }
  }

  return "";
}

function getAccessType(work: OpenAlexWork): "free" | "paid" | "unknown" {
  const oaSignals = [
    work.open_access?.is_oa,
    work.best_oa_location?.is_oa,
    work.primary_location?.is_oa,
  ].filter((value): value is boolean => typeof value === "boolean");

  if (oaSignals.some(Boolean)) {
    return "free";
  }

  if (oaSignals.some((value) => value === false)) {
    return "paid";
  }

  return "unknown";
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeAbstractInvertedIndex(index: Record<string, number[]>) {
  const positions = new Map<number, string>();

  for (const [token, tokenPositions] of Object.entries(index)) {
    for (const position of tokenPositions) {
      if (Number.isInteger(position) && position >= 0 && !positions.has(position)) {
        positions.set(position, token);
      }
    }
  }

  const words = Array.from(positions.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, token]) => token);

  return normalizeText(words.join(" "));
}

function buildCacheKey(query: string, page: number, perPage: number) {
  return `${query.toLowerCase()}::${page}::${perPage}`;
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchOpenAlex(url: URL, signal?: AbortSignal) {
  for (let attempt = 0; attempt <= OPENALEX_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENALEX_TIMEOUT_MS);

    const abortListener = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", abortListener, { once: true });
    }

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
        next: { revalidate: 60 },
      });

      if (!response.ok && attempt < OPENALEX_RETRY_COUNT && isRetryableStatus(response.status)) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      if (attempt < OPENALEX_RETRY_COUNT && !controller.signal.aborted) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  }

  throw new Error("OpenAlex request failed unexpectedly.");
}

function mapOpenAlexWorkToSource(work: OpenAlexWork): Source {
  const authors = (work.authorships ?? [])
    .map((authorship) => authorship.author?.display_name?.trim())
    .filter((name): name is string => Boolean(name));

  return {
    id: work.id ?? crypto.randomUUID(),
    title: work.title?.trim() || "Untitled source",
    authors,
    publicationDate: work.publication_date ?? "",
    citationCount: work.cited_by_count ?? 0,
    accessType: getAccessType(work),
    summary:
      work.abstract_inverted_index && Object.keys(work.abstract_inverted_index).length > 0
        ? decodeAbstractInvertedIndex(work.abstract_inverted_index)
        : undefined,
    externalUrl: normalizeExternalUrl(
      work.primary_location?.landing_page_url,
      work.primary_location?.pdf_url,
      work.id
    ),
  };
}

export async function searchOpenAlexPage(
  query: string,
  options: OpenAlexSearchOptions = {}
): Promise<OpenAlexSearchPageResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      perPage: options.perPage ?? 25,
      hasMore: false,
    };
  }

  const perPage = clampInteger(options.perPage ?? 25, 1, 50);
  const page = clampInteger(options.page ?? 1, 1, 20);
  const cacheKey = buildCacheKey(trimmedQuery, page, perPage);
  const cachedValue = openAlexCache.get(cacheKey);
  if (cachedValue && cachedValue.expiresAt > Date.now()) {
    return cachedValue.value;
  }

  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", trimmedQuery);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per-page", String(perPage));
  url.searchParams.set(
    "select",
    [
      "id",
      "title",
      "authorships",
      "publication_date",
      "cited_by_count",
      "relevance_score",
      "open_access",
      "best_oa_location",
      "primary_location",
      "abstract_inverted_index",
    ].join(",")
  );

  const response = await fetchOpenAlex(url, options.signal);

  if (!response.ok) {
    throw new Error(`OpenAlex request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OpenAlexResponse;
  const works = payload.results ?? [];

  const value: OpenAlexSearchPageResult = {
    items: works
      .map((work, index) => ({ work, index }))
      .sort((a, b) => {
        const relevanceA = a.work.relevance_score ?? 0;
        const relevanceB = b.work.relevance_score ?? 0;
        if (relevanceA !== relevanceB) {
          return relevanceB - relevanceA;
        }

        const citedA = a.work.cited_by_count ?? 0;
        const citedB = b.work.cited_by_count ?? 0;
        if (citedA !== citedB) {
          return citedB - citedA;
        }

        const dateA = toUnixDate(a.work.publication_date ?? "");
        const dateB = toUnixDate(b.work.publication_date ?? "");
        if (dateA !== dateB) {
          return dateB - dateA;
        }

        return a.index - b.index;
      })
      .map(({ work }) => mapOpenAlexWorkToSource(work)),
    totalCount: payload.meta?.count ?? works.length,
    page,
    perPage,
    hasMore: page * perPage < (payload.meta?.count ?? works.length),
  };

  openAlexCache.set(cacheKey, {
    expiresAt: Date.now() + OPENALEX_CACHE_TTL_MS,
    value,
  });

  return value;
}

export async function searchOpenAlex(
  query: string,
  perPage = 25,
  options: Omit<OpenAlexSearchOptions, "perPage"> = {}
): Promise<Source[]> {
  const result = await searchOpenAlexPage(query, {
    ...options,
    perPage,
  });

  return result.items;
}
