import { apiError, apiSuccess } from "@/lib/api";
import { getOptionalAiConfig } from "@/lib/env";
import type { Source } from "@/types/domain";

interface SummaryRequestBody {
  source?: Source;
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

const SUMMARY_TIMEOUT_MS = 15_000;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxLength: number) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function buildFallbackSummary(source: Source) {
  const authorText = source.authors.length > 0 ? source.authors.slice(0, 3).join(", ") : "unknown authors";
  const dateText = source.publicationDate || "unknown publication date";

  return [
    `${source.title} is an academic source by ${authorText}.`,
    `It was published on ${dateText} and has ${source.citationCount} recorded citations.`,
    "Use the external link and abstract details to verify how directly it supports your exact claim.",
  ].join(" ");
}

function buildSummaryPrompt(source: Source) {
  const abstractText = source.summary?.trim() || "No abstract text was provided.";
  const authorText = source.authors.length > 0 ? source.authors.join(", ") : "Unknown authors";

  return [
    "You are writing a concise academic source summary for students.",
    "Write 3 to 4 sentences.",
    "Keep it factual and neutral. Do not invent methods, results, or statistics.",
    "If details are missing, explicitly say the metadata is limited.",
    "Mention likely relevance for research but avoid certainty claims.",
    "",
    `Title: ${source.title}`,
    `Authors: ${authorText}`,
    `Publication date: ${source.publicationDate || "Unknown"}`,
    `Citation count: ${source.citationCount}`,
    `URL: ${source.externalUrl || "Unknown"}`,
    `Abstract/context: ${abstractText}`,
  ].join("\n");
}

function parseOpenAiText(payload: OpenAiChatCompletionResponse) {
  return normalizeText(payload.choices?.[0]?.message?.content ?? "");
}

function parseGoogleText(payload: GoogleGenerateContentResponse) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return normalizeText(parts.map((part) => part.text ?? "").join(" "));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = SUMMARY_TIMEOUT_MS) {
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

function getGoogleModel(model: string) {
  return model.startsWith("gemini") ? model : "gemini-1.5-flash";
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
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: "You summarize academic sources with high factual caution.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI summary provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const text = parseOpenAiText(payload);
  if (!text) {
    throw new Error("AI summary provider returned an empty response.");
  }

  return text;
}

async function generateWithGoogle(prompt: string, apiKey: string, model: string, baseUrl?: string) {
  const endpointBase = (baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    ""
  );
  const selectedModel = getGoogleModel(model);
  const response = await fetchWithTimeout(
    `${endpointBase}/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
          maxOutputTokens: 220,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`AI summary provider returned status ${response.status}.`);
  }

  const payload = (await response.json()) as GoogleGenerateContentResponse;
  const text = parseGoogleText(payload);
  if (!text) {
    throw new Error("AI summary provider returned an empty response.");
  }

  return text;
}

async function generateAiSummary(source: Source) {
  const { apiKey, baseUrl, model } = getOptionalAiConfig();
  if (!apiKey) {
    throw new Error("AI_API_KEY is not configured.");
  }

  const prompt = buildSummaryPrompt(source);

  if (apiKey.startsWith("AIza")) {
    return generateWithGoogle(prompt, apiKey, model, baseUrl);
  }

  return generateWithOpenAiCompatible(prompt, apiKey, model, baseUrl);
}

export async function POST(request: Request) {
  let body: SummaryRequestBody;

  try {
    body = (await request.json()) as SummaryRequestBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const source = body.source;
  if (!source || !source.id || !source.title) {
    return apiError("BAD_REQUEST", "Source with id and title is required.", 400);
  }

  const fallbackSummary = buildFallbackSummary(source);

  try {
    const aiSummary = await generateAiSummary(source);
    return apiSuccess({
      summary: clipText(aiSummary, 1200),
      provider: "ai",
      usedFallback: false,
    });
  } catch (error) {
    return apiSuccess({
      summary: clipText(fallbackSummary, 1200),
      provider: "fallback",
      usedFallback: true,
      warning: error instanceof Error ? error.message : "AI summary unavailable.",
    });
  }
}
