import { apiError, apiSuccess } from "@/lib/api";
import { searchOpenAlex } from "@/lib/openalex";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  if (!query) {
    return apiError("BAD_REQUEST", "Query parameter 'q' is required.", 400);
  }

  try {
    const sources = await searchOpenAlex(query);
    return apiSuccess(sources);
  } catch (error) {
    return apiError(
      "UPSTREAM_ERROR",
      "Failed to fetch sources from OpenAlex. Please retry.",
      502,
      error instanceof Error ? error.message : "Unknown upstream error"
    );
  }
}
