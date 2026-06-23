"use client";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";
import { routingDryRunReloadHref } from "@/lib/routing-dry-run/routing-dry-run-reload";
import { routingDryRunCleanHref, routingDryRunSafeHref } from "@/lib/routing-dry-run/routing-dry-run-query";

export default function RoutingDryRunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const safeHref = routingDryRunSafeHref();
  const cleanHref = routingDryRunCleanHref();
  const reloadHref = routingDryRunReloadHref();

  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Routing dry-run page failed to load">
        Routing dry-run action failed. Check server logs.
        {error.message ? (
          <span className="mt-2 block font-mono text-xs text-muted-foreground">{error.message}</span>
        ) : null}
        {error.digest ? (
          <span className="mt-1 block font-mono text-xs text-muted-foreground">
            digest: {error.digest}
          </span>
        ) : null}
      </WarningBanner>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.assign(reloadHref);
          }}
        >
          Reload routing dry-run
        </Button>
        <a
          href={cleanHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Open clean filter
        </a>
        <a
          href={safeHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Safe mode (limit 5)
        </a>
      </div>
    </div>
  );
}
