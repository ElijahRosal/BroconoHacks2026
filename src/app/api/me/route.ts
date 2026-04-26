import { apiSuccess } from "@/lib/api";
import { withProtectedApi } from "@/lib/protected-api";

export const GET = withProtectedApi(async ({ user }) => {
  return apiSuccess({
    user,
  });
});
