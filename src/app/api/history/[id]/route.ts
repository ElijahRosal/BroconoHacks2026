import { apiError, apiSuccess } from "@/lib/api";
import { deleteEnhancedQueryItem, deleteSearchHistoryItem } from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

interface HistoryRouteContext {
  params: Promise<{ id: string }>;
}

export const DELETE = withProtectedApi<HistoryRouteContext>(
  async ({ user, request, routeContext }) => {
    const id = (await routeContext.params)?.id?.trim() ?? "";
    const url = new URL(request.url);
    const type = (url.searchParams.get("type") ?? "search").trim();

    if (!id) {
      return apiError("BAD_REQUEST", "History item id is required.", 400);
    }

    if (type !== "search" && type !== "enhanced") {
      return apiError("BAD_REQUEST", "History item type must be search or enhanced.", 400);
    }

    try {
      const deleted =
        type === "enhanced"
          ? await deleteEnhancedQueryItem(user.id, id)
          : await deleteSearchHistoryItem(user.id, id);

      if (!deleted) {
        return apiError("NOT_FOUND", "History item not found.", 404);
      }

      return apiSuccess({ deleted: true, type });
    } catch (error) {
      return apiError(
        "INTERNAL_ERROR",
        "Unable to delete history item.",
        500,
        error instanceof Error ? error.message : "Unknown history delete error"
      );
    }
  }
);
