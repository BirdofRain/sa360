import { BULK_IMPORT_APPROVE_PHRASE } from "./types";

export type ApproveDeliveryReadiness = {
  phraseAccepted: boolean;
  hasSimulatedRows: boolean;
  preflightReady: boolean | null;
  preflightBlockers: string[];
  canApprove: boolean;
  remainingBlockers: string[];
  statusLines: string[];
};

export function resolveApproveDeliveryReadiness(input: {
  approvalText: string;
  eligibleSimulatedCount: number;
  selectedRowCount: number;
  selectedRowsRoutingReady: boolean;
  preflightReady: boolean | null;
  preflightBlockers?: string[];
  mutationActive?: boolean;
}): ApproveDeliveryReadiness {
  const phraseAccepted = input.approvalText.trim() === BULK_IMPORT_APPROVE_PHRASE;
  const hasSimulatedRows = input.eligibleSimulatedCount > 0;
  const preflightBlockers = input.preflightBlockers ?? [];
  const preflightBlocked = input.preflightReady === false;

  const remainingBlockers: string[] = [];
  if (!phraseAccepted) {
    remainingBlockers.push(`Type ${BULK_IMPORT_APPROVE_PHRASE} exactly to enable approval.`);
  }
  if (!hasSimulatedRows) {
    remainingBlockers.push("Simulate at least one row before approving delivery.");
  }
  if (input.selectedRowCount < 1) {
    remainingBlockers.push("Select at least one row for the live canary wave.");
  }
  if (!input.selectedRowsRoutingReady) {
    remainingBlockers.push("Selected row(s) must match an active routing rule.");
  }
  if (preflightBlocked) {
    remainingBlockers.push("Live canary preflight checks must pass before approval.");
    remainingBlockers.push(...preflightBlockers);
  }
  if (input.mutationActive) {
    remainingBlockers.push("An import action is still running.");
  }

  const canApprove =
    !input.mutationActive &&
    phraseAccepted &&
    hasSimulatedRows &&
    input.selectedRowCount > 0 &&
    input.selectedRowsRoutingReady &&
    input.preflightReady === true;

  const statusLines: string[] = [];
  if (phraseAccepted) {
    statusLines.push("Approval phrase accepted.");
  }
  if (!canApprove) {
    if (phraseAccepted && preflightBlocked) {
      statusLines.push("Delivery remains blocked until all preflight checks pass.");
    }
    for (const line of remainingBlockers) {
      if (line.startsWith("Type APPROVE")) continue;
      statusLines.push(line);
    }
  } else if (phraseAccepted) {
    statusLines.push("All checks passed. You can approve the delivery wave.");
  }

  return {
    phraseAccepted,
    hasSimulatedRows,
    preflightReady: input.preflightReady,
    preflightBlockers,
    canApprove,
    remainingBlockers,
    statusLines,
  };
}
