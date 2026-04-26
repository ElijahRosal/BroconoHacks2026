export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Loading app...</p>
        <p className="mt-1 text-sm text-slate-600">
          Preparing Citeable.
        </p>
      </section>
    </main>
  );
}
