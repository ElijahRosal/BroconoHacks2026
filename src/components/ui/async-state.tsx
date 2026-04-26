interface AsyncStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function LoadingState({
  title = "Loading...",
  message = "Please wait while we fetch results.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
    </section>
  );
}

export function EmptyState({ title, message, actionLabel, onAction }: AsyncStateProps) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export function ErrorState({ title, message, actionLabel, onAction }: AsyncStateProps) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
      <p className="text-sm font-semibold text-rose-900">{title}</p>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600"
        >
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}
