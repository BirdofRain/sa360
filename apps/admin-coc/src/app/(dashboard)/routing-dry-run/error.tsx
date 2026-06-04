"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";
import { routingDryRunReloadHref } from "@/lib/routing-dry-run/routing-dry-run-reload";

export default function RoutingDryRunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const reloadHref = routingDryRunReloadHref();

  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Routing dry-run page failed to load">
        Routing dry-run action failed. Check server logs.
        {error.message ? (
          <span className="mt-2 block font-mono text-xs text-muted-foreground">{error.message}</span>
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
            router.push(reloadHref);
            router.refresh();
          }}
        >
          Reload routing dry-run
        </Button>
        <Link
          href={reloadHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium"
        >
          Open clean filter
        </Link>
      </div>
    </div>
  );
}
