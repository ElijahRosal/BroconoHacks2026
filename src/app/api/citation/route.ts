import { apiError, apiSuccess } from "@/lib/api";
import { CITATION_STYLE_VALUES, type CitationStyle } from "@/lib/constants";
import type { Source } from "@/types/domain";

type CitationRequestBody = {
  source?: Partial<Source>;
  style?: CitationStyle;
};

function isCitationStyle(value: string): value is CitationStyle {
  return (CITATION_STYLE_VALUES as readonly string[]).includes(value);
}

interface ParsedAuthor {
  given: string;
  family: string;
  literal: string;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingPeriod(value: string) {
  return value.replace(/\.+$/, "");
}

function stripWrappingQuotes(value: string) {
  return value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
}

function sentence(value: string) {
  const trimmed = cleanText(value);
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function parseAuthorName(fullName: string): ParsedAuthor {
  const cleaned = cleanText(fullName);
  if (!cleaned) {
    return { given: "", family: "", literal: "" };
  }

  if (cleaned.includes(",")) {
    const [family, ...givenParts] = cleaned.split(",").map((part) => cleanText(part));
    const given = givenParts.join(" ");
    return {
      given,
      family,
      literal: given ? `${given} ${family}` : family,
    };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { given: "", family: cleaned, literal: cleaned };
  }

  const given = parts.slice(0, -1).join(" ");
  const family = parts[parts.length - 1];

  return {
    given,
    family,
    literal: `${given} ${family}`,
  };
}

function parsePublicationDate(publicationDate: string) {
  const parts = publicationDate
    .split("-")
    .map((part) => Number(part))
    .filter((part) => Number.isInteger(part) && part > 0);

  if (parts.length === 0) {
    return undefined;
  }

  const [year, month, day] = parts;
  return { year, month, day };
}

function formatMonth(month: number, width: "short" | "long") {
  const date = new Date(Date.UTC(2024, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: width, timeZone: "UTC" }).format(date);
}

function formatMlaDate(publicationDate: string) {
  const parsed = parsePublicationDate(publicationDate);
  if (!parsed) {
    return "n.d.";
  }

  if (!parsed.month) {
    return String(parsed.year);
  }

  const month = formatMonth(parsed.month, "short").replace(/\.$/, "");
  return parsed.day ? `${parsed.day} ${month}. ${parsed.year}` : `${month}. ${parsed.year}`;
}

function formatApaDate(publicationDate: string) {
  const parsed = parsePublicationDate(publicationDate);
  if (!parsed) {
    return "n.d.";
  }

  if (!parsed.month) {
    return String(parsed.year);
  }

  const month = formatMonth(parsed.month, "long");
  return parsed.day ? `${parsed.year}, ${month} ${parsed.day}` : `${parsed.year}, ${month}`;
}

function formatChicagoDate(publicationDate: string) {
  const parsed = parsePublicationDate(publicationDate);
  if (!parsed) {
    return "n.d.";
  }

  if (!parsed.month) {
    return String(parsed.year);
  }

  const month = formatMonth(parsed.month, "long");
  return parsed.day ? `${month} ${parsed.day}, ${parsed.year}` : `${month} ${parsed.year}`;
}

function formatIeeeDate(publicationDate: string) {
  const parsed = parsePublicationDate(publicationDate);
  if (!parsed) {
    return "n.d.";
  }

  if (!parsed.month) {
    return String(parsed.year);
  }

  const month = formatMonth(parsed.month, "short");
  return parsed.day ? `${month} ${parsed.day}, ${parsed.year}` : `${month} ${parsed.year}`;
}

function formatHarvardDate(publicationDate: string) {
  const parsed = parsePublicationDate(publicationDate);
  return parsed ? String(parsed.year) : "n.d.";
}

function initials(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(" ");
}

function joinWithAnd(items: string[]) {
  if (items.length <= 1) {
    return items.join("");
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatMlaAuthors(authors: ParsedAuthor[]) {
  if (authors.length === 0) {
    return "";
  }

  const first = authors[0];
  const firstAuthor = first.given ? `${first.family}, ${first.given}` : first.literal;

  if (authors.length === 1) {
    return firstAuthor;
  }

  if (authors.length === 2) {
    return `${firstAuthor}, and ${authors[1].literal}`;
  }

  return `${firstAuthor}, et al.`;
}

function formatApaAuthors(authors: ParsedAuthor[]) {
  if (authors.length === 0) {
    return "";
  }

  const formatted = authors.map((author) => {
    const authorInitials = initials(author.given);
    return authorInitials ? `${author.family}, ${authorInitials}` : author.literal;
  });

  if (formatted.length > 20) {
    return `${formatted.slice(0, 19).join(", ")}, ... ${formatted[formatted.length - 1]}`;
  }

  if (formatted.length === 1) {
    return formatted[0];
  }

  if (formatted.length === 2) {
    return `${formatted[0]}, & ${formatted[1]}`;
  }

  return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

function formatChicagoAuthors(authors: ParsedAuthor[]) {
  if (authors.length === 0) {
    return "";
  }

  const [first, ...rest] = authors;
  const firstAuthor = first.given ? `${first.family}, ${first.given}` : first.literal;

  if (rest.length === 0) {
    return firstAuthor;
  }

  if (rest.length === 1) {
    return `${firstAuthor}, and ${rest[0].literal}`;
  }

  return joinWithAnd([firstAuthor, ...rest.map((author) => author.literal)]);
}

function formatIeeeAuthors(authors: ParsedAuthor[]) {
  if (authors.length === 0) {
    return "";
  }

  if (authors.length > 6) {
    const first = authors[0];
    const firstInitials = initials(first.given);
    return `${firstInitials ? `${firstInitials} ${first.family}` : first.literal} et al.`;
  }

  return joinWithAnd(
    authors.map((author) => {
      const authorInitials = initials(author.given);
      return authorInitials ? `${authorInitials} ${author.family}` : author.literal;
    })
  );
}

function formatHarvardAuthors(authors: ParsedAuthor[]) {
  if (authors.length === 0) {
    return "";
  }

  if (authors.length > 3) {
    const first = authors[0];
    const firstInitials = initials(first.given);
    return `${first.family}, ${firstInitials || first.given} et al.`;
  }

  return joinWithAnd(
    authors.map((author) => {
      const authorInitials = initials(author.given);
      return authorInitials ? `${author.family}, ${authorInitials}` : author.literal;
    })
  );
}

function formatAccessedDate(date = new Date()) {
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(date);
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function buildCitation(source: Source, style: CitationStyle) {
  const authors = source.authors.map(parseAuthorName).filter((author) => author.literal);
  const authorText =
    style === "MLA"
      ? formatMlaAuthors(authors)
      : style === "APA"
        ? formatApaAuthors(authors)
        : style === "Chicago"
          ? formatChicagoAuthors(authors)
          : style === "IEEE"
            ? formatIeeeAuthors(authors)
            : formatHarvardAuthors(authors);
  const title = stripWrappingQuotes(stripTrailingPeriod(source.title));
  const url = cleanText(source.externalUrl);

  if (style === "MLA") {
    return [
      authorText ? `${authorText}.` : "",
      `"${sentence(title)}"`,
      `${formatMlaDate(source.publicationDate)}.`,
      url,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (style === "APA") {
    return [
      authorText ? sentence(authorText) : "",
      `(${formatApaDate(source.publicationDate)}).`,
      sentence(title),
      url,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (style === "Chicago") {
    return [
      authorText ? `${authorText}.` : "",
      `"${sentence(title)}"`,
      `${formatChicagoDate(source.publicationDate)}.`,
      url,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (style === "IEEE") {
    return [
      `[1] ${authorText ? `${authorText},` : ""}`,
      `"${title},"`,
      `${formatIeeeDate(source.publicationDate)}.`,
      url ? `[Online]. Available: ${url}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return [
    authorText ? `${authorText}` : "",
    `(${formatHarvardDate(source.publicationDate)})`,
    `'${title}'.`,
    url ? `Available at: ${url} (Accessed: ${formatAccessedDate()}).` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeSource(source: Partial<Source>): Source {
  return {
    id: source.id ?? "",
    title: cleanText(source.title ?? ""),
    authors: source.authors ?? [],
    publicationDate: source.publicationDate ?? "",
    citationCount: source.citationCount ?? 0,
    externalUrl: source.externalUrl ?? "",
    summary: source.summary,
    accessType: source.accessType,
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
    const citationText = buildCitation(normalizeSource(source), style);

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
