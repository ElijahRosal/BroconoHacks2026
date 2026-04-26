import Link from "next/link";

import { verifyEmailWithToken } from "@/lib/models/user";

interface VerifyEmailPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

async function verifyToken(token: string) {
  if (!token) {
    return {
      ok: false as const,
      message: "Missing verification token.",
    };
  }

  const user = await verifyEmailWithToken(token);
  if (!user) {
    return {
      ok: false as const,
      message: "Verification link is invalid or expired.",
    };
  }

  return {
    ok: true as const,
    email: user.email,
  };
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const token = (await searchParams).token?.trim() ?? "";
  const result = await verifyToken(token);

  if (!result.ok) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center px-4 py-12">
        <section className="w-full rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 shadow-sm">
          <h1 className="text-xl font-semibold">Email verification failed</h1>
          <p className="mt-2 text-sm">{result.message}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold underline">
            Return to home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center px-4 py-12">
      <section className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800 shadow-sm">
        <h1 className="text-xl font-semibold">Email verified</h1>
        <p className="mt-2 text-sm">Your account is now active. You can log in on the home page.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold underline">
          Continue to home
        </Link>
      </section>
    </main>
  );
}
