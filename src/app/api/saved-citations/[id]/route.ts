import { apiError, apiSuccess } from "@/lib/api";
import { deleteSavedCitation } from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

interface SavedCitationRouteContext {
  params: Promise<{ id: string }>;
}

export const DELETE = withProtectedApi<SavedCitationRouteContext>(
  async ({ user, routeContext }) => {
    const id = (await routeContext.params)?.id?.trim() ?? "";

    if (!id) {
      return apiError("BAD_REQUEST", "Saved citation id is required.", 400);
    }

    try {
      const deleted = await deleteSavedCitation(user.id, id);
      if (!deleted) {
        return apiError("NOT_FOUND", "Saved citation not found.", 404);
      }

      return apiSuccess({ deleted: true });
    } catch (error) {
      return apiError(
        "INTERNAL_ERROR",
        "Unable to delete saved citation.",
        500,
        error instanceof Error ? error.message : "Unknown saved citation delete error"
      );
    }
  }
);
