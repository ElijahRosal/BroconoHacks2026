import { apiError, apiSuccess } from "@/lib/api";
import {
  clearEnhancedQueryItems,
  clearSearchHistory,
  listEnhancedQueryItems,
  listSearchHistory,
} from "@/lib/models/saved-data";
import { withProtectedApi } from "@/lib/protected-api";

type HistoryClearType = "search" | "enhanced" | "all";

function getHistoryClearType(request: Request): HistoryClearType {
  const url = new URL(request.url);
  const rawType = (url.searchParams.get("type") ?? "all").trim().toLowerCase();

  if (rawType === "search" || rawType === "enhanced" || rawType === "all") {
    return rawType;
  }

  return "all";
}

export const GET = withProtectedApi(async ({ user }) => {
  try {
    const [searchHistory, enhancedQueries] = await Promise.all([
      listSearchHistory(user.id),
      listEnhancedQueryItems(user.id),
    ]);

    return apiSuccess({ searchHistory, enhancedQueries });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to load history.",
      500,
      error instanceof Error ? error.message : "Unknown history list error"
    );
  }
});

export const DELETE = withProtectedApi(async ({ user, request }) => {
  const clearType = getHistoryClearType(request);

  try {
    if (clearType === "search") {
      const searchDeletedCount = await clearSearchHistory(user.id);
      return apiSuccess({
        clearType,
        searchDeletedCount,
        enhancedDeletedCount: 0,
      });
    }

    if (clearType === "enhanced") {
      const enhancedDeletedCount = await clearEnhancedQueryItems(user.id);
      return apiSuccess({
        clearType,
        searchDeletedCount: 0,
        enhancedDeletedCount,
      });
    }

    const [searchDeletedCount, enhancedDeletedCount] = await Promise.all([
      clearSearchHistory(user.id),
      clearEnhancedQueryItems(user.id),
    ]);

    return apiSuccess({
      clearType,
      searchDeletedCount,
      enhancedDeletedCount,
    });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to clear history.",
      500,
      error instanceof Error ? error.message : "Unknown history clear error"
    );
  }
});
