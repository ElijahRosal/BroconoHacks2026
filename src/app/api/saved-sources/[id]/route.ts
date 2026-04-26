import { apiError, apiSuccess } from "@/lib/api";
import { deleteSavedSource } from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

interface SavedSourceRouteContext {
  params: Promise<{ id: string }>;
}

export const DELETE = withProtectedApi<SavedSourceRouteContext>(
  async ({ user, routeContext }) => {
    const id = (await routeContext.params)?.id?.trim() ?? "";

    if (!id) {
      return apiError("BAD_REQUEST", "Saved source id is required.", 400);
    }

    try {
      const deleted = await deleteSavedSource(user.id, id);
      if (!deleted) {
        return apiError("NOT_FOUND", "Saved source not found.", 404);
      }

      return apiSuccess({ deleted: true });
    } catch (error) {
      return apiError(
        "INTERNAL_ERROR",
        "Unable to delete saved source.",
        500,
        error instanceof Error ? error.message : "Unknown saved source delete error"
      );
    }
  }
);
