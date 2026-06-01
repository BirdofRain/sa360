"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { portalLogoutAction } from "@/app/actions/portal-login";
import type { ClientPortalRangeKey } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: { key: ClientPortalRangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
];

function formatLabelList(labels: string[]): string {
  return labels.map((l) => l.replace(/_/g, " ")).join(" · ");
}

export function PortalHeader({
  displayName,
  locationLabel,
  nicheLabels,
  productLabels,
  rangeLabel,
  rangeKey,
  generatedAt,
  showSignOut = false,
}: {
  displayName: string;
  locationLabel?: string | null;
  nicheLabels?: string[];
  productLabels?: string[];
  rangeLabel: string;
  rangeKey: ClientPortalRangeKey;
  generatedAt: string;
  showSignOut?: boolean;
}) {
  const focusLine = [
    ...(nicheLabels?.length ? [formatLabelList(nicheLabels)] : []),
    ...(productLabels?.length ? [formatLabelList(productLabels)] : []),
  ].join(" · ");
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
          {focusLine ? (
            <p className="mt-0.5 text-sm text-slate-500">{focusLine}</p>
          ) : null}
          <p className="mt-1 text-sm text-slate-500">
            {rangeLabel} · Updated {formatRelativeTime(generatedAt)}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
        {showSignOut ? (
          <form action={portalLogoutAction}>
            <button
              type="submit"
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Sign out
            </button>
          </form>
        ) : null}
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
      </div>
    </header>
  );
}
