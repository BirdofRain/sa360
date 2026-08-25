export function PortalPageSkeleton({
  cards = 3,
  label = "Loading portal",
}: {
  cards?: number;
  label?: string;
}) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80" role="status">
      <div className="border-b border-slate-200 bg-white/90">
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-3 sm:px-6">
          <div className="h-4 w-28 animate-pulse rounded bg-slate-200/80" />
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200/80" />
          <div className="flex gap-2">
            <div className="h-10 w-20 animate-pulse rounded-lg bg-slate-200/70" />
            <div className="h-10 w-20 animate-pulse rounded-lg bg-slate-200/70" />
            <div className="h-10 w-16 animate-pulse rounded-lg bg-slate-200/70" />
            <div className="h-10 w-20 animate-pulse rounded-lg bg-slate-200/70" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <span className="sr-only">{label}</span>
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200/80" />
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white"
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}
