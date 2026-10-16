import type { ReactNode } from "react";

/** Reviewer chrome. No operator navigation, settings, or customer links. */
export function MetaReviewerShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold leading-tight">SA360</div>
          <div className="text-xs text-slate-500">Meta App Review · Read only</div>
        </div>
        <form action="/meta-review/logout" method="post">
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Sign Out
          </button>
        </form>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
