"use client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <main className="w-full rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-800">Something went wrong.</p>
          <p className="mt-2 text-sm text-slate-700">
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
