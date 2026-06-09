"use client";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Button } from "@/components/ui/button";

export default function DirectDeliveryDemoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Direct Delivery Demo</h1>
      <WarningBanner tone="warn" title="Direct Delivery Demo encountered an error">
        The page hit a client-side exception. You can retry without leaving Admin C.O.C.
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
            window.location.assign("/direct-delivery-demo");
          }}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
