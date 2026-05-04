import { Bell, Command, Search } from "lucide-react";

export function TopBar({ env = "production", title, subtitle }: { env?: "production" | "staging"; title: string; subtitle?: string }) {
  const isProd = env === "production";
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-slate-900" style={{ fontWeight: 600 }}>{title}</h1>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${isProd ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            <span className={`size-1.5 rounded-full ${isProd ? "bg-emerald-500" : "bg-amber-500"}`} />
            {isProd ? "Production" : "Staging"}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">us-east-1</span>
        </div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
          <Search className="size-3.5" />
          <span>Search clients, contacts, events…</span>
          <span className="ml-2 inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200"><Command className="size-3" />K</span>
        </div>
        <button className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100">
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" />
        </button>
      </div>
    </header>
  );
}
