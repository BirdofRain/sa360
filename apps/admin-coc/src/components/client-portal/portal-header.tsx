"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { ClientPortalRangeKey } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: { key: ClientPortalRangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
];

export function PortalHeader({
  displayName,
  locationLabel,
  rangeLabel,
  rangeKey,
  generatedAt,
}: {
  displayName: string;
  locationLabel?: string | null;
  rangeLabel: string;
  rangeKey: ClientPortalRangeKey;
  generatedAt: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Performance overview
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{displayName}</h1>
          {locationLabel ? (
            <p className="mt-0.5 text-sm text-slate-500">{locationLabel}</p>
          ) : null}
          <p className="mt-1 text-sm text-slate-500">
            {rangeLabel} · Updated {formatRelativeTime(generatedAt)}
          </p>
        </div>

        <nav
          className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
          aria-label="Date range"
        >
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.key === rangeKey;
            const params = new URLSearchParams(searchParams.toString());
            params.set("range", opt.key);
            const href = `${pathname}?${params.toString()}`;

            return (
              <Link
                key={opt.key}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
                aria-current={active ? "page" : undefined}
              >
                {opt.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
