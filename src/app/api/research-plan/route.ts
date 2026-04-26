import { apiError, apiSuccess } from "@/lib/api";
import { getOptionalAiConfig } from "@/lib/env";
import { searchOpenAlex } from "@/lib/openalex";
import type { ResearchPlanResponse } from "@/types/domain";

interface ResearchPlanBody {
  query?: string;
  openAccessOnly?: boolean;
}

const MAX_SUGGESTED_QUERIES = 6;
const MIN_SUGGESTED_QUERIES = 3;
const MAX_OPENALEX_CHECKS = 12;
const PLAN_TIMEOUT_MS = 15_000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

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
  "great",
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
  "u",
  "up",
  "was",
  "were",
  "with",
]);

const TERM_CORRECTIONS: Record<string, string> = {
  bana: "banana",
  banas: "bananas",
  bananaa: "banana",
  bananna: "banana",
  banannas: "bananas",
  bannana: "banana",
  bannanas: "bananas",
  bannas: "bananas",
  friut: "fruit",
  friuts: "fruits",
  healhty: "healthy",
  healty: "healthy",
  nutricious: "nutritious",
  nutrious: "nutritious",
  nutritiouss: "nutritious",
  nutritous: "nutritious",
  nutrituous: "nutritious",
};

const ACADEMIC_TERM_REPLACEMENTS: Record<string, string> = {
  filling: "satiety",
  fill: "satiety",
  fruits: "fruit",
  full: "satiety",
  healthy: "health",
  nutritious: "nutrition",
};

const SUPPORTING_TOPIC_TERMS = new Set([
  "appetite",
  "diet",
  "dietary",
  "fiber",
  "fruit",
  "fullness",
  "health",
  "nutrition",
  "nutritional",
  "satiety",
]);

const NUTRITION_INTENT_TERMS = new Set([
  "appetite",
  "banana",
  "bananas",
  "calories",
  "diet",
  "dietary",
  "fiber",
  "fruit",
  "fruits",
  "fullness",
  "nutrition",
  "nutritional",
  "nutritious",
  "protein",
  "satiety",
  "vitamin",
  "vitamins",
]);

const TERM_SYNONYMS: Record<string, string[]> = {
  appetite: ["hunger", "satiety"],
  banana: ["bananas", "fruit"],
  bananas: ["banana", "fruit"],
  fiber: ["dietary fiber"],
  fruit: ["dietary fruit", "produce"],
  health: ["health benefits", "health effects"],
  nutrition: ["nutritional value", "dietary quality"],
  satiety: ["fullness", "appetite control"],
};

function compactQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTerm(term: string) {
  return TERM_CORRECTIONS[term] ?? term;
}

function toAcademicTerm(term: string) {
  return ACADEMIC_TERM_REPLACEMENTS[term] ?? term;
}

function splitTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => normalizeTerm(term.trim()))
    .map((term) => toAcademicTerm(term))
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms.map((term) => compactQuery(term)).filter(Boolean)));
}

function clipList(items: string[], maxItems: number) {
  return uniqueTerms(items).slice(0, maxItems);
}

function countSharedTerms(left: string, right: string) {
  const leftTerms = new Set(splitTerms(left));
  const rightTerms = new Set(splitTerms(right));
  let shared = 0;

  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      shared += 1;
    }
  }

  return shared;
}

function buildSubjectPhrase(terms: string[]) {
  const [firstTerm, secondTerm] = terms;
  if (!firstTerm) {
    return "";
  }

  if (secondTerm && !SUPPORTING_TOPIC_TERMS.has(secondTerm)) {
    return `${firstTerm} ${secondTerm}`;
  }

  return firstTerm;
}

function hasNutritionIntent(terms: string[]) {
  return terms.some((term) => NUTRITION_INTENT_TERMS.has(term));
}

function buildSynonyms(terms: string[]) {
  const synonyms = terms.flatMap((term) => TERM_SYNONYMS[term] ?? []);

  return uniqueTerms(synonyms).filter((synonym) => !terms.includes(synonym)).slice(0, 8);
}

function buildSuggestedQueryCandidates(query: string, terms: string[]) {
  const baseQuery = compactQuery(query);
  const focusTerms = terms.slice(0, 4);
  const basePhrase = focusTerms.length > 0 ? focusTerms.join(" ") : baseQuery;
  const subjectPhrase = buildSubjectPhrase(terms) || basePhrase;
  const subjectTerms = new Set(subjectPhrase.split(" "));
  const supportingTerms = terms.filter((term) => !subjectTerms.has(term));
  const candidates: string[] = [];

  if (hasNutritionIntent(terms) && subjectPhrase) {
    candidates.push(
      `${subjectPhrase} nutrition`,
      `${subjectPhrase} health benefits`,
      `${subjectPhrase} nutritional value`,
      `${subjectPhrase} dietary fiber`,
      `${subjectPhrase} satiety`,
      `${subjectPhrase} consumption health`,
      `${subjectPhrase} fruit nutrition`
    );
  }

  for (const term of supportingTerms.slice(0, 4)) {
    if (term !== subjectPhrase) {
      candidates.push(`${subjectPhrase} ${term}`);
    }
  }

  candidates.push(
    `${basePhrase} systematic review`,
    `${basePhrase} meta analysis`,
    `${basePhrase} research evidence`,
    `${basePhrase} academic literature`,
    `${basePhrase} observational study`,
    `${basePhrase} randomized trial`,
    basePhrase,
    baseQuery
  );

  return uniqueTerms(candidates).slice(0, MAX_OPENALEX_CHECKS);
}

async function getSearchableSuggestedQueries(candidates: string[], openAccessOnly = false) {
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const sources = await searchOpenAlex(candidate, 1, { openAccessOnly });
        return sources.length > 0 ? candidate : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((candidate): candidate is string => Boolean(candidate));
}

function buildHeuristicResearchPlan(query: string) {
  const terms = uniqueTerms(splitTerms(query));
  const baseQuery = compactQuery(query);
  const focusTerms = terms.slice(0, 5);
  const keywordTerms = terms.slice(0, 5);
  const synonyms = buildSynonyms(focusTerms);
  const suggestedQueryCandidates = buildSuggestedQueryCandidates(query, terms);

  const refinedQuestion = suggestedQueryCandidates[0] ?? baseQuery;

  return {
    refinedQuestion,
    suggestedQueries: suggestedQueryCandidates,
    keywords: keywordTerms.length > 0 ? keywordTerms : splitTerms(baseQuery).slice(0, 4),
    synonyms: synonyms.length > 0 ? synonyms : focusTerms.map((term) => `${term} research`),
  };
}

function stripMarkdownFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function sanitizeRefinedQuery(text: string) {
  const normalized = normalizeText(stripMarkdownFences(text));
  if (!normalized) {
    return "";
  }

  const withoutLabel = normalized
    .replace(/^refined question:\s*/i, "")
    .replace(/^refined query:\s*/i, "")
    .replace(/^refined search query:\s*/i, "")
    .replace(/^question:\s*/i, "")
    .replace(/^query:\s*/i, "")
    .replace(/^refined_query:\s*/i, "");
  const blockedPhrases = [
    "here is the json requested",
    "```",
    "{",
    "}",
    '"refinedQuestion"',
    '"suggestedQueries"',
    "json requested",
    "valid json",
  ];

  const lower = withoutLabel.toLowerCase();
  if (blockedPhrases.some((phrase) => lower.includes(phrase))) {
    return "";
  }

  const firstLine = withoutLabel.split(/\r?\n/)[0]?.trim() ?? "";
  const candidate = stripDanglingQueryLabel(firstLine.replace(/[.?!]+$/, ""));
  const candidateLower = candidate.toLowerCase();

  if (
    candidate.length < 8 ||
    candidate.length > 220 ||
    blockedPhrases.some((phrase) => candidateLower.includes(phrase))
  ) {
    return "";
  }

  const badEndings = [
    " of",
    " in",
    " for",
    " with",
    " about",
    " on",
    " to",
    " by",
    " field of",
    " effects of",
    " impact of",
    " role of",
    " challenges in",
    " advancements in",
    " in the field of",
  ];

  if (badEndings.some((ending) => candidateLower.endsWith(ending))) {
    return "";
  }

  if (!isCompleteResearchQuery(candidate)) {
    return "";
  }

  const looksLikeSearchQuery =
    !/^(what|how|why|which|to what extent|in what ways|does|do|is|are|can|should)\b/i.test(candidate) &&
    /[a-z]/i.test(candidate);

  return looksLikeSearchQuery ? candidate : "";
}

function parseOpenAiText(payload: OpenAiChatCompletionResponse) {
  return normalizeText(payload.choices?.[0]?.message?.content ?? "");
}

function parseGoogleText(payload: GoogleGenerateContentResponse) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return normalizeText(parts.map((part) => part.text ?? "").join(" "));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = PLAN_TIMEOUT_MS) {
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

function buildResearchPlanPrompt(query: string, heuristicPlan: ResearchPlanResponse) {
  return [
    "You generate academic search plans for literature review and scientific research.",
    "",
    "OUTPUT FORMAT (STRICT):",
    "REFINED_QUERY: <academic search phrase>",
    "QUERIES:",
    "- <broad search query>",
    "- <narrow focused search query>",
    "- <review or systematic review query>",
    "- <alternative phrasing query>",
    "- <optional fifth query if useful>",
    "KEYWORDS: <k1> | <k2> | <k3> | <k4>",
    "SYNONYMS: <s1> | <s2> | <s3> | <s4>",
    "",
    "CRITICAL RULES:",
    "- REFINE QUERY MUST be a clean academic search phrase (NOT a question).",
    "- It must be 3–10 words, noun-phrase style.",
    "- It must not end with prepositions (of, in, for, with, about).",
    "- It must NOT include labels like QUERY, KEYWORDS, SYNONYMS.",
    "- Queries must be distinct and useful for academic database search.",
    "- Do NOT repeat words unnecessarily across queries.",
    "- Avoid generic terms like 'research', 'study', or 'results' alone.",
    "",
    "QUALITY TARGET:",
    "- Think like a Google Scholar / OpenAlex search expert.",
    "- Prefer terms used in peer-reviewed literature.",
    "",
    `USER TOPIC: ${compactQuery(query)}`,
    "",
    "BACKGROUND (for reference only, do not copy blindly):",
    `Heuristic refined query: ${heuristicPlan.refinedQuestion}`,
    `Heuristic queries: ${heuristicPlan.suggestedQueries.join(" | ")}`,
    `Heuristic keywords: ${heuristicPlan.keywords.join(" | ")}`,
    `Heuristic synonyms: ${heuristicPlan.synonyms.join(" | ")}`,
  ].join("\n");
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
      .map((item) => stripDanglingQueryLabel(normalizeText(item)))
      .filter(Boolean),
    maxItems
  );
}

function stripDanglingQueryLabel(text: string) {
  return text.replace(/\s+(?:refined\s+query|search\s+query|query)\s*$/i, "").trim();
}

function hasSuspiciousTrailingToken(candidate: string) {
  const trailingToken = candidate.match(/([A-Za-z]+)$/)?.[1];
  if (!trailingToken) {
    return false;
  }

  if (trailingToken.length >= 4) {
    return false;
  }

  if (/^[A-Z0-9]{2,4}$/.test(trailingToken)) {
    return false;
  }

  return true;
}

function isCompleteResearchQuery(candidate: string) {
  const normalized = normalizeText(candidate);
  if (normalized.length < 12 || normalized.length > 220) {
    return false;
  }

  const terms = splitTerms(normalized);
  if (terms.length < 3) {
    return false;
  }

  const fragmentPatterns = [
    /^(impact|effects|role|relationship|association|study|research|analysis)\s+of\b/i,
    /\b(?:impact|effects|role|relationship|association|study|research|analysis)\s*$/i,
    /\b(?:of|in|for|with|about|on|to|by|under)\s*$/i,
  ];

  if (fragmentPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (hasSuspiciousTrailingToken(normalized)) {
    return false;
  }

  return true;
}

function normalizeQueryCandidate(text: string) {
  return stripDanglingQueryLabel(normalizeText(text));
}

function sameQueryCandidate(left: string, right: string) {
  return compactQuery(normalizeQueryCandidate(left)).toLowerCase() === compactQuery(normalizeQueryCandidate(right)).toLowerCase();
}

function matchesUserIntent(originalQuery: string, candidate: string) {
  const normalizedOriginal = compactQuery(originalQuery);
  const normalizedCandidate = normalizeQueryCandidate(candidate);

  if (!normalizedOriginal || !normalizedCandidate) {
    return false;
  }

  if (sameQueryCandidate(normalizedOriginal, normalizedCandidate)) {
    return true;
  }

  const originalTerms = uniqueTerms(splitTerms(normalizedOriginal));
  const candidateTerms = uniqueTerms(splitTerms(normalizedCandidate));
  if (originalTerms.length === 0 || candidateTerms.length === 0) {
    return false;
  }

  const sharedTerms = countSharedTerms(normalizedOriginal, normalizedCandidate);
  const minimumSharedTerms = Math.min(Math.max(1, Math.ceil(originalTerms.length / 2)), 3);

  return sharedTerms >= minimumSharedTerms;
}

function pickBestRefinedQuestion(
  originalQuery: string,
  aiRefinedQuestion: string | null | undefined,
  heuristicRefinedQuestion: string
) {
  const candidates = [aiRefinedQuestion, heuristicRefinedQuestion, compactQuery(originalQuery)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
  );

  return candidates.find((candidate) => matchesUserIntent(originalQuery, candidate)) ?? compactQuery(originalQuery);
}

function parseAiResearchPlanText(text: string) {
  const cleaned = stripMarkdownFences(text);
  const refinedQuestion = sanitizeRefinedQuery(
    cleaned.match(/^REFINED_QUERY:\s*(.+)$/im)?.[1] ??
      cleaned.match(/^QUERY:\s*(.+)$/im)?.[1] ??
      cleaned
  );

  const suggestedQueries = clipList(
    [
      ...Array.from(cleaned.matchAll(/^QUERY:\s*(.+)$/gim)).map((match) => match[1] ?? ""),
      ...Array.from(cleaned.matchAll(/^\s*-\s+(.+)$/gim)).map((match) => match[1] ?? ""),
    ]
      .map((candidate) => normalizeQueryCandidate(candidate))
      .filter((candidate) => Boolean(candidate) && !sameQueryCandidate(candidate, refinedQuestion)),
    MAX_SUGGESTED_QUERIES
  );

  const keywords = parseLabeledListLine(cleaned, "KEYWORDS", 5);
  const synonyms = parseLabeledListLine(cleaned, "SYNONYMS", 8);

  return {
    refinedQuestion,
    suggestedQueries,
    keywords,
    synonyms,
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
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: "You produce concise, well-formed academic research planning JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Research plan provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const text = parseOpenAiText(payload);
  if (!text) {
    throw new Error("Research plan provider returned an empty response.");
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
          temperature: 0.3,
          maxOutputTokens: 300,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Research plan provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as GoogleGenerateContentResponse;
  const text = parseGoogleText(payload);
  if (!text) {
    throw new Error("Research plan provider returned an empty response.");
  }

  return text;
}

async function generateAiResearchPlan(query: string, heuristicPlan: ResearchPlanResponse) {
  const { apiKey, baseUrl, model } = getOptionalAiConfig();
  if (!apiKey) {
    return null;
  }

  const resolvedModel = resolveModel(apiKey, model);
  const prompt = buildResearchPlanPrompt(query, heuristicPlan);
  const responseText = isGoogleApiKey(apiKey)
    ? await generateWithGoogle(prompt, apiKey, resolvedModel, baseUrl)
    : await generateWithOpenAiCompatible(prompt, apiKey, resolvedModel, baseUrl);

  const parsedPlan = parseAiResearchPlanText(responseText);
  const refinedQuestion = parsedPlan.refinedQuestion;
  if (!refinedQuestion) {
    throw new Error("Research plan provider returned an unusable refined search query.");
  }

  return {
    refinedQuestion,
    suggestedQueries: parsedPlan.suggestedQueries,
    keywords: parsedPlan.keywords,
    synonyms: parsedPlan.synonyms,
  };
}

async function buildResearchPlan(query: string, openAccessOnly = false): Promise<ResearchPlanResponse> {
  const heuristicPlan = buildHeuristicResearchPlan(query);
  let aiPlan: Awaited<ReturnType<typeof generateAiResearchPlan>> = null;
  let warning = "";

  try {
    aiPlan = await generateAiResearchPlan(query, heuristicPlan);
  } catch (error) {
    warning =
      error instanceof Error && error.message
        ? `AI enhancement unavailable. ${error.message}`
        : "AI enhancement unavailable. Using fallback research plan.";
  }
  const selectedRefinedQuestion = pickBestRefinedQuestion(
    query,
    aiPlan?.refinedQuestion,
    heuristicPlan.refinedQuestion
  );
  const mergedCandidates = clipList(
  [
    selectedRefinedQuestion,
    aiPlan?.refinedQuestion,
    heuristicPlan.refinedQuestion,
    ...(aiPlan?.suggestedQueries ?? []),
    ...heuristicPlan.suggestedQueries,
    compactQuery(query),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0),
  MAX_OPENALEX_CHECKS
  );
  const searchableQueries = await getSearchableSuggestedQueries(mergedCandidates, openAccessOnly);
  const suggestedQueries =
    searchableQueries.length >= MIN_SUGGESTED_QUERIES
      ? searchableQueries.slice(0, MAX_SUGGESTED_QUERIES)
      : clipList([...searchableQueries, ...mergedCandidates], MAX_SUGGESTED_QUERIES).slice(
          0,
          MIN_SUGGESTED_QUERIES
        );

  const filteredSuggestedQueries = suggestedQueries.filter(
    (candidate) => !sameQueryCandidate(candidate, selectedRefinedQuestion)
  );

  if (!sameQueryCandidate(selectedRefinedQuestion, aiPlan?.refinedQuestion ?? "")) {
    warning = warning
      ? `${warning} Refined query was adjusted to stay closer to the original topic.`
      : "Refined query was adjusted to stay closer to the original topic.";
  }

  return {
    refinedQuestion: selectedRefinedQuestion,
    suggestedQueries:
      filteredSuggestedQueries.length >= MIN_SUGGESTED_QUERIES
        ? filteredSuggestedQueries
        : suggestedQueries.filter((candidate) => !sameQueryCandidate(candidate, selectedRefinedQuestion)),
    keywords:
      aiPlan?.keywords && aiPlan.keywords.length > 0 ? aiPlan.keywords : heuristicPlan.keywords,
    synonyms:
      aiPlan?.synonyms && aiPlan.synonyms.length > 0 ? aiPlan.synonyms : heuristicPlan.synonyms,
    aiUsed: Boolean(aiPlan?.refinedQuestion && sameQueryCandidate(selectedRefinedQuestion, aiPlan.refinedQuestion)),
    warning,
  };
}

export async function POST(request: Request) {
  let body: ResearchPlanBody;

  try {
    body = (await request.json()) as ResearchPlanBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const query = body.query?.trim() ?? "";
  const openAccessOnly = body.openAccessOnly ?? false;
  if (!query) {
    return apiError("BAD_REQUEST", "Query is required.", 400);
  }

  try {
    const plan = await buildResearchPlan(query, openAccessOnly);
    return apiSuccess(plan);
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to build a research plan right now.",
      500,
      error instanceof Error ? error.message : "Unknown research plan error"
    );
  }
}
