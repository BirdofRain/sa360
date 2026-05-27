"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import {
  confidenceBadgeClass,
  deliveryModeBadgeClass,
  destinationClientLabel,
  displayLeadLabel,
  displayMatchType,
  formatRoutingDryRunTime,
  matchBadgeClass,
  matchStatusLabel,
} from "@/lib/routing-dry-run/routing-dry-run-display";
import {
  deliveryPlanStatusBadgeClass,
  deliveryPlanSummaryLabel,
} from "@/lib/routing-dry-run/delivery-plan-display";
import {
  validationStatusBadgeClass,
  validationStatusLabel,
} from "@/lib/routing-dry-run/routing-dry-run-validation-display";
import { RoutingDryRunDetailDrawer } from "@/components/dashboard/routing-dry-run-detail-drawer";
import { cn } from "@/lib/utils";

function cellOrDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

export function RoutingDryRunTable({
  items,
  emptyHint,
}: {
  items: RoutingDryRunDecisionItem[];
  emptyHint?: string | null;
}) {
  const [selected, setSelected] = useState<RoutingDryRunDecisionItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openRow(row: RoutingDryRunDecisionItem) {
    setSelected(row);
    setDrawerOpen(true);
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
              <TableHead>Delivery plan</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Match type</TableHead>
              <TableHead>Destination client</TableHead>
              <TableHead>Destination subaccount</TableHead>
              <TableHead>Rule ID</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Delivery mode</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center text-muted-foreground">
                  {emptyHint ?? "No routing dry-run decisions."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openRow(row)}
                >
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {formatRoutingDryRunTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-sm">{displayLeadLabel(row)}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.sourceLeadUid}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("w-fit", matchBadgeClass(row.matched))}>
                      {matchStatusLabel(row)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("w-fit", validationStatusBadgeClass(row.validationStatus))}
                    >
                      {validationStatusLabel(row.validationStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "w-fit",
                        deliveryPlanStatusBadgeClass(row.deliveryPlanSummary?.status)
                      )}
                    >
                      {deliveryPlanSummaryLabel(row.deliveryPlanSummary)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("w-fit", confidenceBadgeClass(row.confidence, row.matched))}
                    >
                      {row.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{displayMatchType(row.matchType)}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs">
                    {destinationClientLabel(row)}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">
                    {cellOrDash(row.destinationSubaccountIdGhl)}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs text-muted-foreground">
                    {cellOrDash(row.matchedRuleId)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs" title={row.reason}>
                    {row.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("w-fit", deliveryModeBadgeClass())}>
                      {row.deliveryMode}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RoutingDryRunDetailDrawer
        row={selected}
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setSelected(null);
        }}
        onRowUpdated={(item) => setSelected(item)}
      />
    </>
  );
}
