import type { NextResponse } from "next/server";

import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth-guard";

type ProtectedHandler<TContext = unknown> = (context: {
  user: AuthenticatedUser;
  request: Request;
  routeContext: TContext;
}) =>
  | Promise<NextResponse>
  | NextResponse;

export function withProtectedApi<TContext = unknown>(handler: ProtectedHandler<TContext>) {
  return async function protectedRouteHandler(request: Request, routeContext: TContext) {
    const { user, response } = await requireAuthenticatedUser();

    if (!user) {
      return response;
    }

    return handler({ user, request, routeContext });
  };
}
