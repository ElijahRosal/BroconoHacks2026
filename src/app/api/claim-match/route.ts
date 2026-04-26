import { apiError, apiSuccess } from "@/lib/api";
import { searchOpenAlex } from "@/lib/openalex";
import type { ClaimMatch, ClaimMatchSearchResponse, Source } from "@/types/domain";

interface ClaimMatchBody {
  claim?: string;
}

function tokenizeClaim(claim: string) {
  return claim
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms));
}

function buildRetrievalQueries(claim: string) {
  const terms = uniqueTerms(tokenizeClaim(claim));
  const focusTerms = terms.slice(0, 4);
  const baseClaim = claim.trim();

  return uniqueTerms([
    `${baseClaim} scholarly sources`,
    `${baseClaim} research evidence`,
    `${baseClaim} academic literature`,
    ...focusTerms.map((term) => `${term} research sources`),
  ]).slice(0, 5);
}

function buildRefinedQuestion(claim: string, terms: string[]) {
  if (terms.length === 0) {
    return `Which sources best support or evaluate ${claim.trim()}?`;
  }

  return `Which sources best support or evaluate the claim about ${terms.slice(0, 4).join(" and ")}?`;
}

function buildKeywords(claim: string) {
  return uniqueTerms(tokenizeClaim(claim)).slice(0, 6);
}

function scoreSourceForClaim(source: Source, claimTerms: string[], queryHitCount: number) {
  const titleTerms = tokenizeClaim(source.title);
  const titleMatches = claimTerms.filter((term) => titleTerms.includes(term));
  const matchCount = titleMatches.length;
  const citationBonus = Math.min(Math.log10((source.citationCount ?? 0) + 1) * 4, 12);
  const queryBonus = Math.min(queryHitCount * 4, 12);
  const recencyYear = source.publicationDate ? new Date(source.publicationDate).getFullYear() : 0;
  const recencyBonus = recencyYear >= 2020 ? 6 : recencyYear >= 2015 ? 3 : 0;
  const score = matchCount * 24 + citationBonus + queryBonus + recencyBonus;

  const confidence: ClaimMatch["confidence"] =
    score >= 40 ? "High" : score >= 22 ? "Medium" : "Low";

  const rationaleParts = [
    titleMatches.length > 0 ? `matches ${titleMatches.join(", ")} in the title` : "is a topical search result",
    queryHitCount > 1 ? `appears in ${queryHitCount} retrieval queries` : "appears in a retrieval query",
    source.citationCount > 0 ? `has ${source.citationCount} citations` : "has no citation count listed",
  ];

  return {
    score,
    confidence,
    rationale: rationaleParts.join(", ") + ".",
  };
}

function dedupeSources(sources: Source[]) {
  const seen = new Map<string, Source>();

  for (const source of sources) {
    if (!seen.has(source.id)) {
      seen.set(source.id, source);
    }
  }

  return Array.from(seen.values());
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "15", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 30) : 15;

  let body: ClaimMatchBody;

  try {
    body = (await request.json()) as ClaimMatchBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const claim = body.claim?.trim() ?? "";
  if (!claim) {
    return apiError("BAD_REQUEST", "Claim is required.", 400);
  }

  if (claim.length > 800) {
    return apiError("BAD_REQUEST", "Claim is too long.", 400);
  }

  const claimTerms = buildKeywords(claim);
  const retrievalQueries = buildRetrievalQueries(claim);
  const refinedQuestion = buildRefinedQuestion(claim, claimTerms);

  try {
    const searchResults = await Promise.all(
      retrievalQueries.map(async (retrievalQuery) => {
        try {
          const sources = await searchOpenAlex(retrievalQuery, 12);
          return { retrievalQuery, sources };
        } catch {
          return { retrievalQuery, sources: [] as Source[] };
        }
      })
    );

    const sourceHitCounts = new Map<string, number>();
    for (const result of searchResults) {
      for (const source of result.sources) {
        sourceHitCounts.set(source.id, (sourceHitCounts.get(source.id) ?? 0) + 1);
      }
    }

    const sources = dedupeSources(searchResults.flatMap((result) => result.sources));
    const matches = sources
      .map((source) => {
        const sourceHitCount = sourceHitCounts.get(source.id) ?? 0;
        const matchContext = scoreSourceForClaim(source, claimTerms, sourceHitCount);

        return {
          sourceId: source.id,
          score: Number(matchContext.score.toFixed(2)),
          confidence: matchContext.confidence,
          rationale: matchContext.rationale,
        } satisfies ClaimMatch;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    const pageStart = (page - 1) * limit;
    const pageEnd = pageStart + limit;
    const pagedMatches = matches.slice(pageStart, pageEnd);
    const pagedSourceIds = new Set(pagedMatches.map((match) => match.sourceId));
    const pagedSources = sources.filter((source) => pagedSourceIds.has(source.id));

    const responseBody: ClaimMatchSearchResponse = {
      originalClaim: claim,
      refinedQuestion,
      retrievalQueries,
      keywords: claimTerms,
      page,
      limit,
      totalResults: matches.length,
      hasMore: pageEnd < matches.length,
      sources: pagedSources.sort((a, b) => {
        const matchA = matches.find((match) => match.sourceId === a.id)?.score ?? 0;
        const matchB = matches.find((match) => match.sourceId === b.id)?.score ?? 0;
        if (matchA !== matchB) {
          return matchB - matchA;
        }

        if (a.citationCount !== b.citationCount) {
          return b.citationCount - a.citationCount;
        }

        return a.title.localeCompare(b.title);
      }),
      matches: pagedMatches,
    };

    const response = apiSuccess(responseBody);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    return response;
  } catch (error) {
    const response = apiSuccess<ClaimMatchSearchResponse>({
      originalClaim: claim,
      refinedQuestion,
      retrievalQueries,
      keywords: claimTerms,
      page,
      limit,
      totalResults: 0,
      hasMore: false,
      sources: [],
      matches: [],
      matchError:
        error instanceof Error ? error.message : "Unable to rank claim matches right now.",
    });

    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    return response;
  }
}
