import type { NextResponse } from "next/server";

import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth-guard";

type ProtectedHandler = (context: { user: AuthenticatedUser }) =>
  | Promise<NextResponse>
  | NextResponse;

export function withProtectedApi(handler: ProtectedHandler) {
  return async function protectedRouteHandler() {
    const { user, response } = await requireAuthenticatedUser();

    if (!user) {
      return response;
    }

    return handler({ user });
  };
}
