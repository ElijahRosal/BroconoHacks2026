import type { Source } from "@/types/domain";

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
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

function toUnixDate(date: string): number {
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
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
    externalUrl:
      work.primary_location?.landing_page_url ??
      work.primary_location?.pdf_url ??
      work.id ??
      "",
  };
}

export async function searchOpenAlex(query: string, perPage = 25): Promise<Source[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
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
      "primary_location",
    ].join(",")
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`OpenAlex request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OpenAlexResponse;
  const works = payload.results ?? [];

  return works
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
    .map(({ work }) => mapOpenAlexWorkToSource(work));
}
