export default function NotificationRecipientLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      <p className="text-sm text-slate-600" role="status">
        Loading notification recipient…
      </p>
    </div>
  );
}
