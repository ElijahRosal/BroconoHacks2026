import { apiError, apiSuccess } from "@/lib/api";
import { CITATION_STYLE_VALUES, type CitationStyle } from "@/lib/constants";
import {
  clearSavedCitations,
  listSavedCitations,
  saveCitation,
} from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

interface SaveCitationBody {
  sourceId?: string;
  sourceTitle?: string;
  style?: CitationStyle;
  citationText?: string;
}

function isCitationStyle(value: string): value is CitationStyle {
  return (CITATION_STYLE_VALUES as readonly string[]).includes(value);
}

export const GET = withProtectedApi(async ({ user }) => {
  try {
    const items = await listSavedCitations(user.id);
    return apiSuccess({ items });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to load saved citations.",
      500,
      error instanceof Error ? error.message : "Unknown saved citation list error"
    );
  }
});

export const POST = withProtectedApi(async ({ user, request }) => {
  let body: SaveCitationBody;

  try {
    body = (await request.json()) as SaveCitationBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const sourceId = body.sourceId?.trim() ?? "";
  const sourceTitle = body.sourceTitle?.trim() ?? "";
  const style = body.style;
  const citationText = body.citationText?.trim() ?? "";

  if (!sourceId || !sourceTitle || !citationText || !style || !isCitationStyle(style)) {
    return apiError("BAD_REQUEST", "Valid citation fields are required.", 400);
  }

  try {
    const item = await saveCitation({
      userId: user.id,
      sourceId,
      sourceTitle,
      style,
      citationText,
    });

    if (!item) {
      return apiError("INTERNAL_ERROR", "Unable to save citation.", 500);
    }

    return apiSuccess({ item }, 201);
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to save citation.",
      500,
      error instanceof Error ? error.message : "Unknown saved citation create error"
    );
  }
});

export const DELETE = withProtectedApi(async ({ user }) => {
  try {
    const deletedCount = await clearSavedCitations(user.id);
    return apiSuccess({ deletedCount });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to clear saved citations.",
      500,
      error instanceof Error ? error.message : "Unknown saved citation clear error"
    );
  }
});
