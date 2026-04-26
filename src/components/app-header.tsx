"use client";

import Link from "next/link";
import { BookOpenCheck } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-900 text-white shadow-sm">
            <BookOpenCheck aria-hidden className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-slate-950 sm:text-base">
              AI Citation Finder
            </span>
            <span className="hidden text-xs text-slate-600 sm:block">
              Search, cite, and save academic sources
            </span>
          </span>
        </Link>

        <AccountMenu />
      </div>
    </header>
  );
}
