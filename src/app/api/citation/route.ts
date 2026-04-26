import { apiError, apiSuccess } from "@/lib/api";
import { CITATION_STYLE_VALUES, type CitationStyle } from "@/lib/constants";
import type { Source } from "@/types/domain";

type CitationRequestBody = {
  source?: Partial<Source>;
  style?: CitationStyle;
};

const STYLE_TEMPLATE_MAP: Record<CitationStyle, string> = {
  MLA: "mla",
  APA: "apa",
  Chicago: "chicago",
  IEEE: "ieee",
  Harvard: "harvard-cite-them-right",
};

function isCitationStyle(value: string): value is CitationStyle {
  return (CITATION_STYLE_VALUES as readonly string[]).includes(value);
}

function parseAuthorName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { literal: fullName.trim() };
  }

  return {
    given: parts.slice(0, -1).join(" "),
    family: parts[parts.length - 1],
  };
}

function buildIssuedDate(publicationDate: string) {
  if (!publicationDate) {
    return undefined;
  }

  const parts = publicationDate
    .split("-")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return {
    "date-parts": [parts],
  };
}

function mapSourceToCsl(source: Source) {
  return {
    id: source.id,
    type: "article-journal",
    title: source.title,
    author: source.authors.map(parseAuthorName),
    issued: buildIssuedDate(source.publicationDate),
    URL: source.externalUrl,
  };
}

export async function POST(request: Request) {
  let body: CitationRequestBody;

  try {
    body = (await request.json()) as CitationRequestBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const source = body.source;
  const style = body.style;

  if (!source?.title || !source.id) {
    return apiError("BAD_REQUEST", "A source with id and title is required.", 400);
  }

  if (!style || !isCitationStyle(style)) {
    return apiError("BAD_REQUEST", "A supported citation style is required.", 400);
  }

  try {
    const { default: Cite } = await import("citation-js");
    const cite = new Cite(mapSourceToCsl({
      id: source.id,
      title: source.title,
      authors: source.authors ?? [],
      publicationDate: source.publicationDate ?? "",
      citationCount: source.citationCount ?? 0,
      externalUrl: source.externalUrl ?? "",
      summary: source.summary,
    }));

    const citationText = cite
      .format("bibliography", {
        format: "text",
        template: STYLE_TEMPLATE_MAP[style],
        lang: "en-US",
      })
      .trim();

    return apiSuccess({
      citationText,
      style,
    });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Citation generation failed. Please retry.",
      500,
      error instanceof Error ? error.message : "Unknown citation error"
    );
  }
}
