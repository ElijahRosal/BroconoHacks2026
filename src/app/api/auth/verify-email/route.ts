import { apiError, apiSuccess } from "@/lib/api";
import { verifyEmailWithToken } from "@/lib/models/user";

export async function POST(request: Request) {
  let body: { token?: string };

  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return apiError("BAD_REQUEST", "Request body must be valid JSON.", 400);
  }

  const token = body.token?.trim() ?? "";
  if (!token) {
    return apiError("BAD_REQUEST", "Verification token is required.", 400);
  }

  try {
    const user = await verifyEmailWithToken(token);
    if (!user) {
      return apiError("BAD_REQUEST", "Verification link is invalid or expired.", 400);
    }

    return apiSuccess({
      message: "Email verified. You can now log in.",
      email: user.email,
    });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to verify email right now. Please retry.",
      500,
      error instanceof Error ? error.message : "Unknown verification error"
    );
  }
}
