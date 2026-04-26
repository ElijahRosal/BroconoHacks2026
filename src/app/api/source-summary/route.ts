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

interface OpenAlexWorkResponse {
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

interface CrossrefWorkResponse {
  message?: {
    title?: string[] | null;
    abstract?: string | null;
  } | null;
}

interface PdfParseResult {
  text?: string;
}

const SUMMARY_TIMEOUT_MS = 15_000;
const MAX_PAPER_TEXT_LENGTH = 12_000;
const MAX_ABSTRACT_TEXT_LENGTH = 8_000;
const ABSTRACT_META_NAMES = [
  "citation_abstract",
  "dc.description",
  "dcterms.abstract",
  "description",
  "og:description",
  "twitter:description",
];

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

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&#(\d+);/g, (_, code: string) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    });
}

function stripHtml(value: string) {
  return normalizeText(decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")));
}

async function parsePdfText(pdfBuffer: Buffer) {
  const pdfParse = (await import("pdf-parse")) as unknown as (
    buffer: Buffer
  ) => Promise<PdfParseResult>;
  const result = await pdfParse(pdfBuffer);
  return normalizeText(result.text ?? "");
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

  return normalizeText(
    Array.from(positions.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, token]) => token)
      .join(" ")
  );
}

function isLikelyRealAbstract(text: string) {
  const normalized = normalizeText(text);
  if (normalized.length < 120) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return !(
    lower.startsWith("this source appears to discuss ") ||
    lower.includes("use the external link and abstract details to verify") ||
    lower.includes("metadata-only summary was returned")
  );
}

function extractDoi(source: Source) {
  const candidates = [source.externalUrl, source.pdfUrl, source.id];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const match = candidate.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function extractOpenAlexWorkId(source: Source) {
  const candidates = [source.id, source.externalUrl];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const fromPath = candidate.match(/(?:openalex\.org\/)?(W\d{3,})/i)?.[1];
    if (fromPath) {
      return fromPath.toUpperCase();
    }
  }

  return null;
}

function extractMetaContent(html: string, targetName: string) {
  const metaTagPattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
    "i"
  );
  const reversedMetaTagPattern = new RegExp(
    `<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:name|property)=["']${targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i"
  );

  const match = html.match(metaTagPattern) ?? html.match(reversedMetaTagPattern);
  return match?.[1] ? stripHtml(match[1]) : "";
}

function extractHtmlAbstractSection(html: string) {
  const sectionPatterns = [
    /<(section|div)[^>]+(?:id|class)=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
    /<h\d[^>]*>\s*abstract\s*<\/h\d>\s*([\s\S]{0,6000}?)(?:<h\d|<\/article>|<\/main>|<\/section>)/i,
  ];

  for (const pattern of sectionPatterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const candidate = stripHtml(match[2] ?? match[1] ?? "");
    if (isLikelyRealAbstract(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function fetchOpenAlexAbstract(source: Source) {
  const workId = extractOpenAlexWorkId(source);
  if (!workId) {
    return null;
  }

  const url = new URL(`https://api.openalex.org/works/${encodeURIComponent(workId)}`);
  url.searchParams.set("select", "title,abstract_inverted_index");

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as OpenAlexWorkResponse;
  const abstractIndex = payload.abstract_inverted_index;
  if (!abstractIndex || Object.keys(abstractIndex).length === 0) {
    return null;
  }

  const decoded = decodeAbstractInvertedIndex(abstractIndex);
  if (!decoded) {
    return null;
  }

  return {
    abstractText: decoded,
    title: payload.title?.trim() || source.title,
  };
}

async function fetchAbstractFromLandingPage(source: Source) {
  const externalUrl = source.externalUrl?.trim();
  if (!externalUrl || !/^https?:\/\//i.test(externalUrl)) {
    return null;
  }

  const response = await fetchWithTimeout(externalUrl, {
    headers: {
      Accept: "text/html,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.1",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("pdf")) {
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const extractedText = await parsePdfText(pdfBuffer);
    if (!extractedText || extractedText.length < 500) {
      return null;
    }

    return {
      abstractText: clipText(extractedText, MAX_PAPER_TEXT_LENGTH),
      abstractSource: "landing-page-pdf",
      sourceType: "paper-text" as const,
    };
  }

  if (!contentType.includes("html")) {
    return null;
  }

  const html = await response.text();
  for (const metaName of ABSTRACT_META_NAMES) {
    const content = extractMetaContent(html, metaName);
    if (isLikelyRealAbstract(content)) {
      return {
        abstractText: clipText(content, MAX_ABSTRACT_TEXT_LENGTH),
        abstractSource: "landing-page-meta",
        sourceType: "abstract" as const,
      };
    }
  }

  const sectionText = extractHtmlAbstractSection(html);
  if (!sectionText) {
    return null;
  }

  return {
    abstractText: clipText(sectionText, MAX_ABSTRACT_TEXT_LENGTH),
    abstractSource: "landing-page-section",
    sourceType: "abstract" as const,
  };
}

async function fetchCrossrefAbstract(source: Source) {
  const doi = extractDoi(source);
  if (!doi) {
    return null;
  }

  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as CrossrefWorkResponse;
  const abstractText = stripHtml(payload.message?.abstract ?? "");
  if (!isLikelyRealAbstract(abstractText)) {
    return null;
  }

  return {
    abstractText: clipText(abstractText, MAX_ABSTRACT_TEXT_LENGTH),
    title: payload.message?.title?.[0]?.trim() || source.title,
  };
}

async function fetchOpenAccessPdfText(source: Source) {
  const pdfUrl = source.pdfUrl?.trim();
  if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) {
    return null;
  }

  const response = await fetchWithTimeout(pdfUrl, {
    headers: {
      Accept: "application/pdf,text/plain;q=0.9,*/*;q=0.1",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().includes("pdf")) {
    return null;
  }

  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  const extractedText = await parsePdfText(pdfBuffer);
  if (!extractedText || extractedText.length < 500) {
    return null;
  }

  return clipText(extractedText, MAX_PAPER_TEXT_LENGTH);
}

async function resolveAbstractContext(source: Source) {
  const pdfText = await fetchOpenAccessPdfText(source);
  if (pdfText) {
    return {
      source,
      abstractText: pdfText,
      abstractSource: "open-access-pdf",
      sourceType: "paper-text" as const,
    };
  }

  const embeddedAbstract = normalizeText(source.summary ?? "");
  if (isLikelyRealAbstract(embeddedAbstract)) {
    return {
      source,
      abstractText: clipText(embeddedAbstract, MAX_ABSTRACT_TEXT_LENGTH),
      abstractSource: "search-result",
      sourceType: "abstract" as const,
    };
  }

  const fetched = await fetchOpenAlexAbstract(source);
  if (fetched) {
    return {
      source: {
        ...source,
        title: fetched.title,
      },
      abstractText: clipText(fetched.abstractText, MAX_ABSTRACT_TEXT_LENGTH),
      abstractSource: "openalex-work",
      sourceType: "abstract" as const,
    };
  }

  const landingPageAbstract = await fetchAbstractFromLandingPage(source);
  if (landingPageAbstract) {
    return {
      source,
      abstractText: landingPageAbstract.abstractText,
      abstractSource: landingPageAbstract.abstractSource,
      sourceType: landingPageAbstract.sourceType,
    };
  }

  const crossrefAbstract = await fetchCrossrefAbstract(source);
  if (crossrefAbstract) {
    return {
      source: {
        ...source,
        title: crossrefAbstract.title,
      },
      abstractText: crossrefAbstract.abstractText,
      abstractSource: "crossref",
      sourceType: "abstract" as const,
    };
  }

  return null;
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

function buildSummaryPrompt(source: Source, abstractText: string, sourceType: "abstract" | "paper-text") {
  const authorText = source.authors.length > 0 ? source.authors.join(", ") : "Unknown authors";
  const contentLabel = sourceType === "paper-text" ? "Paper text excerpt" : "Abstract text";
  const contentInstruction =
    sourceType === "paper-text"
      ? "Summarize the actual paper content excerpt provided below."
      : "Summarize the actual paper abstract content provided below.";

  return [
    "You are writing a concise academic source summary for students.",
    "Write 4 to 6 sentences.",
    contentInstruction,
    "Keep it factual and neutral. Do not invent methods, results, or statistics.",
    "Cover: research objective, method/design if present, major findings, and limitations/uncertainties.",
    "If the provided text omits a detail, explicitly say it is not stated.",
    "",
    `Title: ${source.title}`,
    `Authors: ${authorText}`,
    `Publication date: ${source.publicationDate || "Unknown"}`,
    `Citation count: ${source.citationCount}`,
    `URL: ${source.externalUrl || "Unknown"}`,
    `${contentLabel}: ${abstractText}`,
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

async function generateAiSummary(source: Source, abstractText: string, sourceType: "abstract" | "paper-text") {
  const { apiKey, baseUrl, model } = getOptionalAiConfig();
  if (!apiKey) {
    throw new Error("AI_API_KEY is not configured.");
  }

  const prompt = buildSummaryPrompt(source, abstractText, sourceType);

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
    const context = await resolveAbstractContext(source);
    if (!context) {
      return apiSuccess({
        summary: clipText(fallbackSummary, 1200),
        provider: "fallback",
        usedFallback: true,
        warning:
          "No paper abstract is available for this source yet, so a metadata-only summary was returned.",
      });
    }

    const aiSummary = await generateAiSummary(context.source, context.abstractText, context.sourceType);
    return apiSuccess({
      summary: clipText(aiSummary, 1200),
      provider: "ai",
      usedFallback: false,
      abstractSource: context.abstractSource,
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
