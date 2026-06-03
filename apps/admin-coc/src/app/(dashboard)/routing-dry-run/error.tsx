"use client";

import Link from "next/link";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";

export default function RoutingDryRunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Routing dry-run page failed to load">
        Routing dry-run action failed. Check server logs.
        {error.message ? (
          <span className="mt-2 block font-mono text-xs text-muted-foreground">{error.message}</span>
        ) : null}
      </WarningBanner>
      <div className="flex gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Link
          href="/routing-dry-run"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium"
        >
          Reload routing dry-run
        </Link>
      </div>
    </div>
  );
}
