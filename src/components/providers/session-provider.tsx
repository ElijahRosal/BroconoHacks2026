"use client";

import { SessionProvider } from "next-auth/react";

interface AppSessionProviderProps {
  children: React.ReactNode;
}

export function AppSessionProvider({ children }: AppSessionProviderProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
