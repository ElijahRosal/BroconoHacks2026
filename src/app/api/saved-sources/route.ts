import { apiError, apiSuccess } from "@/lib/api";
import { type Source } from "@/types/domain";
import {
  clearSavedSources,
  listSavedSources,
  saveSource,
} from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

interface SaveSourceBody {
  source?: Partial<Source>;
}

function parseSource(body: SaveSourceBody): Source | null {
  const source = body.source;

  if (!source?.id || !source.title) {
    return null;
  }

  return {
    id: source.id,
    title: source.title,
    authors: source.authors ?? [],
    publicationDate: source.publicationDate ?? "",
    citationCount: source.citationCount ?? 0,
    externalUrl: source.externalUrl ?? "",
    summary: source.summary,
  };
}

export const GET = withProtectedApi(async ({ user }) => {
  try {
    const items = await listSavedSources(user.id);
    return apiSuccess({ items });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to load saved sources.",
      500,
      error instanceof Error ? error.message : "Unknown saved source list error"
    );
  }
});

export const POST = withProtectedApi(async ({ user, request }) => {
  let body: SaveSourceBody;

  try {
    body = (await request.json()) as SaveSourceBody;
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const source = parseSource(body);
  if (!source) {
    return apiError("BAD_REQUEST", "A valid source is required.", 400);
  }

  try {
    const item = await saveSource({ userId: user.id, source });
    if (!item) {
      return apiError("INTERNAL_ERROR", "Unable to save source.", 500);
    }

    return apiSuccess({ item }, 201);
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to save source.",
      500,
      error instanceof Error ? error.message : "Unknown source save error"
    );
  }
});

export const DELETE = withProtectedApi(async ({ user }) => {
  try {
    const deletedCount = await clearSavedSources(user.id);
    return apiSuccess({ deletedCount });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to clear saved sources.",
      500,
      error instanceof Error ? error.message : "Unknown saved source clear error"
    );
  }
});
