"use client";

import { Bell, Command, Search } from "lucide-react";

import { getPublicRegionLabel, getPublicSa360Env } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Top bar — layout/spacing from `docs/figma/generated-reference/.../TopBar.tsx`.
 * Env pills map `NEXT_PUBLIC_SA360_ENV`; optional `NEXT_PUBLIC_SA360_REGION` for region chip.
 */
export function DashboardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const env = getPublicSa360Env();
  const region = getPublicRegionLabel();

  const isProd = env === "production";
  const isStaging = env === "staging";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
              isProd && "bg-emerald-50 text-emerald-700",
              isStaging && "bg-amber-50 text-amber-800",
              env === "development" && "bg-slate-100 text-slate-600"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isProd && "bg-emerald-500",
                isStaging && "bg-amber-500",
                env === "development" && "bg-slate-400"
              )}
            />
            {isProd ? "Production" : isStaging ? "Staging" : "Development"}
          </span>
          {region ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
              {region}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="hidden shrink-0 items-center gap-3 md:flex">
        <div className="flex max-w-[min(100vw-24rem,28rem)] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
          <Search className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">Search clients, contacts, events…</span>
          <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">
            <Command className="size-3" aria-hidden />
            K
          </span>
        </div>
        <button
          type="button"
          className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications (placeholder)"
        >
          <Bell className="size-4" aria-hidden />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500" aria-hidden />
        </button>
      </div>
    </header>
  );
}
