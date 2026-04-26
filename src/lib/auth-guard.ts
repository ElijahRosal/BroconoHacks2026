import { apiError } from "@/lib/api";
import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

export async function requireAuthenticatedUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.email) {
    return {
      user: null,
      response: apiError("UNAUTHORIZED", "Authentication required.", 401),
    };
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      emailVerified: Boolean(session.user.emailVerified),
    } satisfies AuthenticatedUser,
    response: null,
  };
}
