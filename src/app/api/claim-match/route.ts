import { apiError, apiSuccess } from "@/lib/api";
import { getOptionalAiConfig } from "@/lib/env";
import { searchOpenAlex } from "@/lib/openalex";
import type { ClaimMatch, ClaimMatchSearchResponse, Source } from "@/types/domain";

interface ClaimMatchBody {
  claim?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
}

interface GoogleGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string | null;
      }>;
    };
  }>;
}

interface ClaimPlan {
  refinedQuestion: string;
  retrievalQueries: string[];
  keywords: string[];
}

const MAX_RETRIEVAL_QUERIES = 5;
const MIN_RETRIEVAL_QUERIES = 3;
const CLAIM_TIMEOUT_MS = 15_000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
  "would",
]);

function compactText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeClaim(claim: string) {
  return claim
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms.map((term) => compactText(term)).filter(Boolean)));
}

function clipList(items: string[], maxItems: number) {
  return uniqueTerms(items).slice(0, maxItems);
}

function countSharedTerms(left: string, right: string) {
  const leftTerms = new Set(tokenizeClaim(left));
  const rightTerms = new Set(tokenizeClaim(right));
  let shared = 0;

  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      shared += 1;
    }
  }

  return shared;
}

function buildHeuristicRetrievalQueries(claim: string) {
  const terms = uniqueTerms(tokenizeClaim(claim));
  const focusTerms = terms.slice(0, 4);
  const baseClaim = compactText(claim);
  const phrase = focusTerms.join(" ");

  return clipList(
    [
      `${baseClaim} scholarly sources`,
      `${baseClaim} research evidence`,
      `${baseClaim} academic literature`,
      phrase ? `${phrase} systematic review` : "",
      phrase ? `${phrase} meta analysis` : "",
      ...focusTerms.map((term) => `${term} research sources`),
    ].filter(Boolean),
    MAX_RETRIEVAL_QUERIES
  );
}

function buildRefinedQuestion(claim: string, terms: string[]) {
  if (terms.length === 0) {
    return `Which academic sources best support or challenge the claim "${compactText(claim)}"?`;
  }

  return `Which academic sources best support or challenge the claim about ${terms.slice(0, 4).join(", ")}?`;
}

function buildKeywords(claim: string) {
  return uniqueTerms(tokenizeClaim(claim)).slice(0, 6);
}

function buildHeuristicClaimPlan(claim: string): ClaimPlan {
  const keywords = buildKeywords(claim);

  return {
    refinedQuestion: buildRefinedQuestion(claim, keywords),
    retrievalQueries: buildHeuristicRetrievalQueries(claim),
    keywords,
  };
}

function stripMarkdownFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function sanitizeLine(text: string) {
  return normalizeText(stripMarkdownFences(text)).replace(/[.?!]+$/, "").trim();
}

function sanitizeRefinedQuestion(text: string) {
  const normalized = sanitizeLine(text)
    .replace(/^refined question:\s*/i, "")
    .replace(/^question:\s*/i, "")
    .replace(/^refined_question:\s*/i, "");

  if (!normalized || normalized.length < 16 || normalized.length > 240) {
    return "";
  }

  if (!/[a-z]/i.test(normalized)) {
    return "";
  }

  return normalized.endsWith("?") ? normalized : `${normalized}?`;
}

function normalizeQueryCandidate(text: string) {
  return sanitizeLine(text)
    .replace(/^query:\s*/i, "")
    .replace(/^retrieval query:\s*/i, "")
    .replace(/^search query:\s*/i, "");
}

function matchesClaimIntent(claim: string, candidate: string) {
  const claimTerms = uniqueTerms(tokenizeClaim(claim));
  const candidateTerms = uniqueTerms(tokenizeClaim(candidate));

  if (claimTerms.length === 0 || candidateTerms.length === 0) {
    return false;
  }

  const sharedTerms = countSharedTerms(claim, candidate);
  const minimumSharedTerms = Math.min(Math.max(1, Math.ceil(claimTerms.length / 3)), 3);
  return sharedTerms >= minimumSharedTerms;
}

function parseLabeledListLine(text: string, label: string, maxItems: number) {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = text.match(regex);
  if (!match?.[1]) {
    return [];
  }

  return clipList(
    match[1]
      .split("|")
      .map((item) => sanitizeLine(item))
      .filter(Boolean),
    maxItems
  );
}

function parseOpenAiText(payload: OpenAiChatCompletionResponse) {
  return normalizeText(payload.choices?.[0]?.message?.content ?? "");
}

function parseGoogleText(payload: GoogleGenerateContentResponse) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return normalizeText(parts.map((part) => part.text ?? "").join(" "));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = CLAIM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isGoogleApiKey(apiKey: string) {
  return apiKey.startsWith("AIza");
}

function resolveModel(apiKey: string, model: string) {
  if (isGoogleApiKey(apiKey)) {
    return model.toLowerCase().startsWith("gemini") ? model : DEFAULT_GEMINI_MODEL;
  }

  return model || DEFAULT_OPENAI_MODEL;
}

function buildClaimPlanPrompt(claim: string, heuristicPlan: ClaimPlan) {
  return [
    "You convert student claims into academic evidence retrieval plans for OpenAlex and literature search.",
    "",
    "OUTPUT FORMAT (STRICT):",
    "REFINED_QUESTION: <neutral evidence-seeking question>",
    "RETRIEVAL_QUERIES:",
    "- <broad academic search query>",
    "- <focused query using likely scholarly terms>",
    "- <review or systematic review query>",
    "- <alternative phrasing query>",
    "- <optional fifth query if useful>",
    "KEYWORDS: <k1> | <k2> | <k3> | <k4> | <k5>",
    "",
    "CRITICAL RULES:",
    "- Preserve the user's original claim intent.",
    "- Do not assume the claim is true or false.",
    "- REFINE QUESTION must be neutral and evidence-seeking.",
    "- Retrieval queries must be useful for academic database search, not conversational sentences.",
    "- Prefer peer-reviewed terminology and common literature-review phrasing.",
    "- Keep queries concise and specific enough to retrieve relevant papers.",
    "",
    `USER CLAIM: ${compactText(claim)}`,
    "",
    "BACKGROUND (for reference only, do not copy blindly):",
    `Heuristic refined question: ${heuristicPlan.refinedQuestion}`,
    `Heuristic retrieval queries: ${heuristicPlan.retrievalQueries.join(" | ")}`,
    `Heuristic keywords: ${heuristicPlan.keywords.join(" | ")}`,
  ].join("\n");
}

function parseAiClaimPlanText(text: string) {
  const cleaned = stripMarkdownFences(text);
  const refinedQuestion = sanitizeRefinedQuestion(
    cleaned.match(/^REFINED_QUESTION:\s*(.+)$/im)?.[1] ??
      cleaned.match(/^QUESTION:\s*(.+)$/im)?.[1] ??
      cleaned
  );

  const retrievalQueries = clipList(
    [
      ...Array.from(cleaned.matchAll(/^QUERY:\s*(.+)$/gim)).map((match) => match[1] ?? ""),
      ...Array.from(cleaned.matchAll(/^RETRIEVAL_QUERY:\s*(.+)$/gim)).map((match) => match[1] ?? ""),
      ...Array.from(cleaned.matchAll(/^\s*-\s+(.+)$/gim)).map((match) => match[1] ?? ""),
    ]
      .map((candidate) => normalizeQueryCandidate(candidate))
      .filter(Boolean),
    MAX_RETRIEVAL_QUERIES
  );

  const keywords = parseLabeledListLine(cleaned, "KEYWORDS", 6);

  return {
    refinedQuestion,
    retrievalQueries,
    keywords,
  };
}

async function generateWithOpenAiCompatible(prompt: string, apiKey: string, model: string, baseUrl?: string) {
  const endpointBase = (baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${endpointBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content: "You produce concise, neutral academic evidence-retrieval plans.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claim matching provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const text = parseOpenAiText(payload);
  if (!text) {
    throw new Error("Claim matching provider returned an empty response.");
  }

  return text;
}

async function generateWithGoogle(prompt: string, apiKey: string, model: string, baseUrl?: string) {
  const endpointBase = (baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    ""
  );
  const response = await fetchWithTimeout(
    `${endpointBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 350,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Claim matching provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as GoogleGenerateContentResponse;
  const text = parseGoogleText(payload);
  if (!text) {
    throw new Error("Claim matching provider returned an empty response.");
  }

  return text;
}

async function generateAiClaimPlan(claim: string, heuristicPlan: ClaimPlan) {
  const { apiKey, baseUrl, model } = getOptionalAiConfig();
  if (!apiKey) {
    return null;
  }

  const resolvedModel = resolveModel(apiKey, model);
  const prompt = buildClaimPlanPrompt(claim, heuristicPlan);
  const responseText = isGoogleApiKey(apiKey)
    ? await generateWithGoogle(prompt, apiKey, resolvedModel, baseUrl)
    : await generateWithOpenAiCompatible(prompt, apiKey, resolvedModel, baseUrl);

  const parsedPlan = parseAiClaimPlanText(responseText);
  if (!parsedPlan.refinedQuestion) {
    throw new Error("Claim matching provider returned an unusable refined question.");
  }

  return parsedPlan;
}

function pickBestRefinedQuestion(claim: string, aiRefinedQuestion: string | null | undefined, fallbackQuestion: string) {
  const candidates = [aiRefinedQuestion, fallbackQuestion].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
  );

  return candidates.find((candidate) => matchesClaimIntent(claim, candidate)) ?? fallbackQuestion;
}

function mergeRetrievalQueries(claim: string, selectedRefinedQuestion: string, plans: ClaimPlan[]) {
  const merged = clipList(
    [
      ...plans.flatMap((plan) => plan.retrievalQueries),
      `${compactText(claim)} scholarly sources`,
      `${compactText(claim)} research evidence`,
      selectedRefinedQuestion.replace(/\?$/, ""),
    ],
    MAX_RETRIEVAL_QUERIES * 2
  );

  const aligned = merged.filter((candidate) => matchesClaimIntent(claim, candidate));
  const stable = clipList(aligned.length >= MIN_RETRIEVAL_QUERIES ? aligned : merged, MAX_RETRIEVAL_QUERIES);

  return stable.length >= MIN_RETRIEVAL_QUERIES
    ? stable
    : clipList([...stable, ...buildHeuristicRetrievalQueries(claim)], MAX_RETRIEVAL_QUERIES);
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

  const confidence: ClaimMatch["confidence"] = score >= 40 ? "High" : score >= 22 ? "Medium" : "Low";

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

async function buildClaimPlan(claim: string) {
  const heuristicPlan = buildHeuristicClaimPlan(claim);
  let aiPlan: ClaimPlan | null = null;
  let warning = "";
  const aiConfig = getOptionalAiConfig();

  if (!aiConfig.apiKey) {
    warning = "No API key found. Add your API key in settings or .env.local to enable AI-enhanced claim matching.";
  } else {
    try {
      aiPlan = await generateAiClaimPlan(claim, heuristicPlan);
    } catch (error) {
      warning =
        error instanceof Error && error.message
          ? `AI enhancement unavailable. ${error.message}`
          : "AI enhancement unavailable. Using fallback claim matching plan.";
    }
  }

  const refinedQuestion = pickBestRefinedQuestion(claim, aiPlan?.refinedQuestion, heuristicPlan.refinedQuestion);
  const retrievalQueries = mergeRetrievalQueries(claim, refinedQuestion, [aiPlan ?? heuristicPlan, heuristicPlan]);
  const keywords = clipList([...(aiPlan?.keywords ?? []), ...heuristicPlan.keywords], 6);

  if (aiPlan?.refinedQuestion && refinedQuestion !== aiPlan.refinedQuestion) {
    warning = warning
      ? `${warning} Claim adjusted.`
      : "Claim adjusted.";
  }

  return {
    refinedQuestion,
    retrievalQueries,
    keywords,
    aiUsed: Boolean(aiPlan && aiPlan.retrievalQueries.length > 0),
    warning,
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "15", 10);
  const openAccessOnly = (url.searchParams.get("openAccessOnly") ?? "false").trim() === "true";
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

  const claimPlan = await buildClaimPlan(claim);
  const claimTerms = claimPlan.keywords;
  const retrievalQueries = claimPlan.retrievalQueries;
  const refinedQuestion = claimPlan.refinedQuestion;

  try {
    const searchResults = await Promise.all(
      retrievalQueries.map(async (retrievalQuery) => {
        try {
          const sources = await searchOpenAlex(retrievalQuery, 12, { openAccessOnly });
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
      aiUsed: claimPlan.aiUsed,
      warning: claimPlan.warning,
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
      matchError: error instanceof Error ? error.message : "Unable to rank claim matches right now.",
      aiUsed: claimPlan.aiUsed,
      warning: claimPlan.warning,
    });

    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    return response;
  }
}
