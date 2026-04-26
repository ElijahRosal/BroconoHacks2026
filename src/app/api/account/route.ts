import { apiError, apiSuccess } from "@/lib/api";
import { deleteAllSavedDataForUser } from "@/lib/models/saved-data";
import { deleteUserById, deleteVerificationTokensForUser } from "@/lib/models/user";
import { withProtectedApi } from "@/lib/protected-api";

export const DELETE = withProtectedApi(async ({ user }) => {
  try {
    const [savedDataResult, tokenDeletedCount, userDeleted] = await Promise.all([
      deleteAllSavedDataForUser(user.id),
      deleteVerificationTokensForUser(user.id),
      deleteUserById(user.id),
    ]);

    if (!userDeleted) {
      return apiError("NOT_FOUND", "Account not found.", 404);
    }

    return apiSuccess({
      ...savedDataResult,
      verificationTokensDeleted: tokenDeletedCount,
      userDeleted,
    });
  } catch (error) {
    return apiError(
      "INTERNAL_ERROR",
      "Unable to delete account.",
      500,
      error instanceof Error ? error.message : "Unknown account delete error"
    );
  }
});
