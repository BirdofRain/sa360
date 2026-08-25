export default function PortalLoginLoading() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <span className="sr-only">Loading sign in</span>
      </div>
    </div>
  );
}
