import { apiError, apiSuccess } from "@/lib/api";
import { searchOpenAlex } from "@/lib/openalex";
import type { ResearchPlanResponse } from "@/types/domain";

interface ResearchPlanBody {
  query?: string;
}

const MAX_SUGGESTED_QUERIES = 6;
const MIN_SUGGESTED_QUERIES = 3;
const MAX_OPENALEX_CHECKS = 12;

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

async function getSearchableSuggestedQueries(candidates: string[]) {
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const sources = await searchOpenAlex(candidate, 1);
        return sources.length > 0 ? candidate : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((candidate): candidate is string => Boolean(candidate));
}

async function buildResearchPlan(query: string): Promise<ResearchPlanResponse> {
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

  const candidates = buildSuggestedQueryCandidates(query, terms);
  const searchableQueries = await getSearchableSuggestedQueries(candidates);
  const suggestedQueries =
    searchableQueries.length >= MIN_SUGGESTED_QUERIES
      ? searchableQueries.slice(0, MAX_SUGGESTED_QUERIES)
      : uniqueTerms([...searchableQueries, ...candidates]).slice(0, MIN_SUGGESTED_QUERIES);

  return {
    refinedQuestion,
    suggestedQueries,
    keywords: keywordTerms.length > 0 ? keywordTerms : splitTerms(baseQuery).slice(0, 4),
    synonyms: synonyms.length > 0 ? synonyms : focusTerms.map((term) => `${term} research`),
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
  if (!query) {
    return apiError("BAD_REQUEST", "Query is required.", 400);
  }

  try {
    const plan = await buildResearchPlan(query);
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
