import { apiError, apiSuccess } from "@/lib/api";
import { authOptions } from "@/lib/auth-options";
import { START_MODE_VALUES, type StartMode } from "@/lib/constants";
import { recordSearchHistory } from "@/lib/models/saved-data";
import { searchOpenAlexPage } from "@/lib/openalex";
import { getServerSession } from "next-auth";

function isStartMode(value: string): value is StartMode {
  return (START_MODE_VALUES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const openAccessOnly = (url.searchParams.get("openAccessOnly") ?? "false").trim() === "true";
  const startModeParam = (url.searchParams.get("startMode") ?? "regular-query").trim();
  const startMode: StartMode = isStartMode(startModeParam)
    ? startModeParam
    : START_MODE_VALUES[0];
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 25;

  if (!query) {
    return apiError("BAD_REQUEST", "Query parameter 'q' is required.", 400);
  }

  if (query.length > 500) {
    return apiError("BAD_REQUEST", "Query is too long.", 400);
  }

  try {
    const searchResult = await searchOpenAlexPage(query, {
      page,
      perPage: limit,
      openAccessOnly,
    });

    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      await recordSearchHistory({
        userId: session.user.id,
        query,
        startMode,
      });
    }

    const response = apiSuccess(searchResult);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    return response;
  } catch (error) {
    return apiError(
      "UPSTREAM_ERROR",
      "Failed to fetch sources from OpenAlex. Please retry.",
      502,
      error instanceof Error ? error.message : "Unknown upstream error"
    );
  }
}
