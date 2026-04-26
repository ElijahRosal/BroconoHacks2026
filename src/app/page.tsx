import { START_MODES } from "@/lib/constants";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
          Batch 0 Foundation
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          AI Citation Finder &amp; Generator
        </h1>
        <p className="mt-4 max-w-2xl text-slate-700">
          Project shell is ready. Next steps are implementing OpenAlex search,
          result cards, source details, and citation generation flows.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {START_MODES.map((mode) => (
          <article
            key={mode.value}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-base font-semibold text-slate-900">{mode.label}</h2>
            <p className="mt-2 text-sm text-slate-600">{mode.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
