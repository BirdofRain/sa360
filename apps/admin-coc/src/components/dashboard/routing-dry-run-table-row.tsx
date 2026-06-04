"use client";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  ROUTING_DRY_RUN_ROW_UNAVAILABLE,
  type RoutingDryRunDecisionView,
} from "@/lib/routing-dry-run/routing-dry-run-safe";
import {
  confidenceBadgeClass,
  deliveryModeBadgeClass,
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
  suggestedValidationBadgeClass,
  suggestedValidationLabel,
} from "@/lib/routing-dry-run/routing-dry-run-suggested-display";
import {
  validationStatusBadgeClass,
  validationStatusLabel,
} from "@/lib/routing-dry-run/routing-dry-run-validation-display";
import { RoutingDryRunMarkLegacyButton } from "@/components/dashboard/routing-dry-run-mark-legacy-button";
import { cn } from "@/lib/utils";

function cellOrDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

export function RoutingDryRunUnavailableRow({ row }: { row: RoutingDryRunDecisionView }) {
  return (
    <TableRow className="bg-amber-50/40 dark:bg-amber-950/20">
      <TableCell colSpan={15} className="py-3 text-sm text-amber-950 dark:text-amber-100">
        <span className="font-medium">{ROUTING_DRY_RUN_ROW_UNAVAILABLE}</span>
        {row.id && row.id !== "unavailable-row" ? (
          <span className="ml-2 font-mono text-xs text-muted-foreground">({row.id})</span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function RoutingDryRunTableRow({
  row,
  onOpen,
  onRowUpdated,
}: {
  row: RoutingDryRunDecisionView;
  onOpen: () => void;
  onRowUpdated: (item: RoutingDryRunDecisionView) => void;
}) {
  if (!row.rowPresentable) {
    return <RoutingDryRunUnavailableRow row={row} />;
  }

  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
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
          className={cn("w-fit", suggestedValidationBadgeClass(row.suggestedValidation))}
          title={row.suggestedValidation?.suggestedValidationReason ?? ""}
        >
          {suggestedValidationLabel(row.suggestedValidation)}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn("w-fit", deliveryPlanStatusBadgeClass(row.deliveryPlanSummary?.status))}
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
      <TableCell className="max-w-[140px] truncate text-xs">{cellOrDash(row.destinationClientAccountId)}</TableCell>
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
      <TableCell onClick={(e) => e.stopPropagation()}>
        <RoutingDryRunMarkLegacyButton
          row={row}
          onUpdated={(item) => onRowUpdated({ ...item, rowPresentable: true })}
        />
      </TableCell>
    </TableRow>
  );
}
