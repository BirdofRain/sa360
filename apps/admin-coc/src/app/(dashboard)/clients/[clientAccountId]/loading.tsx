export default function ClientDetailLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      <p className="text-sm text-slate-600" role="status">
        Loading client records…
      </p>
    </div>
  );
}
