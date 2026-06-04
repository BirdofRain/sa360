"use client";

import { useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  normalizeRoutingDryRunDecisionItem,
  safeNormalizeRoutingDryRunDecisionList,
  type RoutingDryRunDecisionView,
} from "@/lib/routing-dry-run/routing-dry-run-safe";
import { RoutingDryRunDetailDrawer } from "@/components/dashboard/routing-dry-run-detail-drawer";
import { RoutingDryRunTableRow } from "@/components/dashboard/routing-dry-run-table-row";

function isPreNormalizedRow(
  item: unknown
): item is RoutingDryRunDecisionView {
  return (
    Boolean(item) &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    "rowPresentable" in (item as Record<string, unknown>)
  );
}

export function RoutingDryRunTable({
  items,
  emptyHint,
  skipNormalize = false,
}: {
  items: RoutingDryRunDecisionView[] | import("@/lib/routing-dry-run/types").RoutingDryRunDecisionItem[];
  emptyHint?: string | null;
  /** When true, items were normalized + RSC-serialized on the server already. */
  skipNormalize?: boolean;
}) {
  const rows =
    skipNormalize && items.every(isPreNormalizedRow)
      ? (items as RoutingDryRunDecisionView[])
      : safeNormalizeRoutingDryRunDecisionList(items);
  const [selected, setSelected] = useState<RoutingDryRunDecisionView | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openRow(row: RoutingDryRunDecisionView) {
    if (!row.rowPresentable) return;
    setSelected({ ...row, rowPresentable: true });
    setDrawerOpen(true);
  }

  function onRowUpdated(item: import("@/lib/routing-dry-run/types").RoutingDryRunDecisionItem) {
    const normalized = safeNormalizeRoutingDryRunDecisionList([item])[0];
    if (!normalized) return;
    setSelected(normalized);
  }

  return (
    <>
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Lead UID</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Validation</TableHead>
              <TableHead>Suggested</TableHead>
              <TableHead>Delivery plan</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Match type</TableHead>
              <TableHead>Destination client</TableHead>
              <TableHead>Destination subaccount</TableHead>
              <TableHead>Rule ID</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Delivery mode</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="h-24 text-center text-muted-foreground">
                  {emptyHint ?? "No routing dry-run decisions."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <RoutingDryRunTableRow
                  key={`${row.id}-${row.rowPresentable ? "ok" : "bad"}`}
                  row={row}
                  onOpen={() => openRow(row)}
                  onRowUpdated={onRowUpdated}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RoutingDryRunDetailDrawer
        row={selected?.rowPresentable ? selected : null}
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setSelected(null);
        }}
        onRowUpdated={(item) => onRowUpdated(item)}
      />
    </>
  );
}
