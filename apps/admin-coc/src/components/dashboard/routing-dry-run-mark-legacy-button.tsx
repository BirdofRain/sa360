"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useTransition } from "react";

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
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onMark(e: MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const res = await updateRoutingDryRunValidationAction(
        row.id,
        buildMatchedLegacyValidationPatch(row)
      );
      if (!res.ok) return;
      onUpdated?.(res.item);
      router.refresh();
    });
  }

  return (
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
  );
}
