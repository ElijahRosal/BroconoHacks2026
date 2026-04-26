import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      emailVerified: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    email?: string | null;
    emailVerified?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    emailVerified?: boolean;
  }
}
