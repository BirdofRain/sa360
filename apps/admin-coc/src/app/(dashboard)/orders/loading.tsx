export default function CocOrdersLoading() {
  return (
    <div className="space-y-4" data-testid="coc-orders-loading">
      <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      <p className="text-sm text-slate-600" role="status">
        Loading orders…
      </p>
    </div>
  );
}
