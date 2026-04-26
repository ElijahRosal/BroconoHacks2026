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

function formatTermList(terms: string[]) {
  if (terms.length <= 1) {
    return terms[0] ?? "";
  }

  if (terms.length === 2) {
    return `${terms[0]} and ${terms[1]}`;
  }

  return `${terms.slice(0, -1).join(", ")}, and ${terms[terms.length - 1]}`;
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

  const phrase = formatTermList(focusTerms.slice(0, 4));
  const refinedQuestion =
    focusTerms.length > 0
      ? `What does current research conclude about ${phrase}?`
      : `What does current research conclude about ${compactQuery(query)}?`;

  return {
    refinedQuestion,
    suggestedQueries: buildSuggestedQueryCandidates(query, terms),
    keywords: keywordTerms.length > 0 ? keywordTerms : splitTerms(baseQuery).slice(0, 4),
    synonyms: synonyms.length > 0 ? synonyms : focusTerms.map((term) => `${term} research`),
  };
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
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
    "You help students turn rough academic topics into better research questions and search queries.",
    "Return valid JSON only with this shape:",
    '{ "refinedQuestion": string, "suggestedQueries": string[], "keywords": string[], "synonyms": string[] }',
    "Rules:",
    "- Write one natural-sounding refined research question, not a template.",
    "- Preserve the user's intent and domain.",
    "- Suggested queries should be concise academic search phrases.",
    "- Keywords should be the most important concepts only.",
    "- Synonyms should be useful alternate search terms.",
    "- Do not include markdown fences or commentary.",
    "",
    `User query: ${compactQuery(query)}`,
    `Heuristic refined question: ${heuristicPlan.refinedQuestion}`,
    `Heuristic suggested queries: ${heuristicPlan.suggestedQueries.join(" | ")}`,
    `Heuristic keywords: ${heuristicPlan.keywords.join(" | ")}`,
    `Heuristic synonyms: ${heuristicPlan.synonyms.join(" | ")}`,
  ].join("\n");
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
          responseMimeType: "application/json",
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

function coerceStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return clipList(
    value.filter((item): item is string => typeof item === "string").map((item) => normalizeText(item)),
    maxItems
  );
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

  const jsonText = extractJsonObject(responseText);
  if (!jsonText) {
    throw new Error("Research plan provider returned invalid JSON.");
  }

  const parsed = JSON.parse(jsonText) as {
    refinedQuestion?: unknown;
    suggestedQueries?: unknown;
    keywords?: unknown;
    synonyms?: unknown;
  };

  const refinedQuestion =
    typeof parsed.refinedQuestion === "string" ? normalizeText(parsed.refinedQuestion) : "";

  return {
    refinedQuestion,
    suggestedQueries: coerceStringArray(parsed.suggestedQueries, MAX_SUGGESTED_QUERIES),
    keywords: coerceStringArray(parsed.keywords, 5),
    synonyms: coerceStringArray(parsed.synonyms, 8),
  };
}

async function buildResearchPlan(query: string, openAccessOnly = false): Promise<ResearchPlanResponse> {
  const heuristicPlan = buildHeuristicResearchPlan(query);
  const aiPlan = await generateAiResearchPlan(query, heuristicPlan).catch(() => null);
  const mergedCandidates = clipList(
    [
      ...(aiPlan?.suggestedQueries ?? []),
      ...heuristicPlan.suggestedQueries,
      compactQuery(query),
    ],
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

  return {
    refinedQuestion:
      aiPlan?.refinedQuestion && aiPlan.refinedQuestion.length > 12
        ? aiPlan.refinedQuestion
        : heuristicPlan.refinedQuestion,
    suggestedQueries,
    keywords:
      aiPlan?.keywords && aiPlan.keywords.length > 0 ? aiPlan.keywords : heuristicPlan.keywords,
    synonyms:
      aiPlan?.synonyms && aiPlan.synonyms.length > 0 ? aiPlan.synonyms : heuristicPlan.synonyms,
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
