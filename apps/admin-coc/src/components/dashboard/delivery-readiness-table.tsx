"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeliveryReadinessConfigDrawer } from "@/components/dashboard/delivery-readiness-config-drawer";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";
import {
  deliveryModeBadgeClass,
  deliveryReadinessTierSummary,
  directCanaryReadinessLabel,
  liveDeliveryAllowedLabel,
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { cn } from "@/lib/utils";

export function DeliveryReadinessTable({
  items,
  emptyHint,
  initialRuleId,
}: {
  items: RoutingRuleWithReadinessItem[];
  emptyHint?: string | null;
  initialRuleId?: string;
}) {
  const [selected, setSelected] = useState<RoutingRuleWithReadinessItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const id = initialRuleId?.trim();
    if (!id) return;
    const match = items.find((row) => row.id === id);
    if (match) {
      setSelected(match);
      setDrawerOpen(true);
    }
  }, [initialRuleId, items]);

  return (
    <>
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Subaccount</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Readiness</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Live OK?</TableHead>
              <TableHead>Blockers</TableHead>
              <TableHead>Next action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  {emptyHint ?? "No routing rules."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelected(row);
                    setDrawerOpen(true);
                  }}
                >
                  <TableCell className="max-w-[140px] truncate text-sm">
                    {row.clientDisplayName ?? row.clientAccountId}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">
                    {row.destinationSubaccountIdGhl || "—"}
                  </TableCell>
                  <TableCell className="text-xs">{row.matchType}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("w-fit", readinessStatusBadgeClass(row.readiness.readinessStatus))}
                      title={deliveryReadinessTierSummary(row.readiness)}
                    >
                      {readinessStatusLabel(row.readiness.readinessStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {directCanaryReadinessLabel(row.readiness.readyForDirectCanary)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("w-fit", deliveryModeBadgeClass(row.deliveryMode))}>
                      {row.deliveryMode}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {liveDeliveryAllowedLabel(row.readiness.canDeliverLive)}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs" title={row.readiness.blockers.join("; ")}>
                    {row.readiness.blockers.length || "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs" title={row.readiness.recommendedNextAction}>
                    {row.readiness.recommendedNextAction}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DeliveryReadinessConfigDrawer
        rule={selected}
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setSelected(null);
        }}
        onUpdated={(item) => setSelected(item)}
      />
    </>
  );
}
