"use client";

import { type MouseEvent, useState, useTransition } from "react";

import { updateRoutingDryRunValidationAction } from "@/app/actions/routing-dry-run";
import { Button } from "@/components/ui/button";
import { buildMatchedLegacyValidationPatch } from "@/lib/routing-dry-run/routing-dry-run-validation-patch";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";

export function RoutingDryRunMarkLegacyButton({
  row,
  onUpdated,
}: {
  row: RoutingDryRunDecisionItem;
  onUpdated?: (item: RoutingDryRunDecisionItem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onMark(e: MouseEvent) {
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      const res = await updateRoutingDryRunValidationAction(
        row.id,
        buildMatchedLegacyValidationPatch(row)
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUpdated?.(res.item);
    });
  }

  return (
    <div className="space-y-1">
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 whitespace-nowrap px-2 text-xs"
      disabled={pending}
      onClick={onMark}
      title="Mark validation as matched legacy"
    >
      {pending ? "…" : "Matched legacy"}
    </Button>
    {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
