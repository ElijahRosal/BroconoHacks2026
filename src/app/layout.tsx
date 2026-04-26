import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppHeader } from "@/components/app-header";
import { AppSessionProvider } from "@/components/providers/session-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Citeable",
  description:
    "Find credible academic sources, read concise summaries, and generate citations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppSessionProvider>
          <AppHeader />
          {children}
        </AppSessionProvider>
      </body>
    </html>
  );
}
