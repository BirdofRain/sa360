import {
  BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
  BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
  BULK_IMPORT_INITIAL_CANARY_MAX_ROWS,
} from "@sa360/shared";
import type { BulkImportOptions } from "./bulk-import.types.js";

export const INITIAL_CANARY_NON_DEMO_WARNING =
  "Initial bulk-import live canaries are restricted to the Smart Agent 360 Demo destination.";

/** Rollout guard: first bulk-import live canaries must target the canonical demo destination only. */
export function isBulkImportInitialCanaryDemoOnlyEnabled(): boolean {
  const raw = process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function isCanonicalDemoBulkImportDestination(
  clientAccountId: string | null | undefined,
  locationIdGhl: string | null | undefined
): boolean {
  return (
    clientAccountId?.trim() === BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID &&
    locationIdGhl?.trim() === BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID
  );
}

export type InitialCanaryRowCandidate = {
  id: string;
  rowNumber: number;
  deliveryStatus: string;
  duplicateStatus: string;
  ghlContactId: string | null;
  sourceLeadEventId: string | null;
  excluded: boolean;
};

export function validateInitialBulkImportCanary(input: {
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  importOptionsJson: unknown;
  rowLimit: number;
  eligibleRows: InitialCanaryRowCandidate[];
}): { ok: true } | { ok: false; error: string; blockers: string[] } {
  if (!isBulkImportInitialCanaryDemoOnlyEnabled()) {
    return { ok: true };
  }

  const blockers: string[] = [];
  const options = (input.importOptionsJson ?? {}) as BulkImportOptions;

  if (
    !isCanonicalDemoBulkImportDestination(
      input.destinationClientAccountId,
      input.destinationLocationIdGhl
    )
  ) {
    blockers.push(INITIAL_CANARY_NON_DEMO_WARNING);
  }

  if (input.rowLimit > BULK_IMPORT_INITIAL_CANARY_MAX_ROWS) {
    blockers.push(
      `Initial bulk-import live canary allows at most ${BULK_IMPORT_INITIAL_CANARY_MAX_ROWS} row per approval.`
    );
  }

  if (options.workflowStrategy !== "source_tag_only") {
    blockers.push(
      "Initial bulk-import live canary requires workflowStrategy source_tag_only."
    );
  }

  if (input.eligibleRows.length > BULK_IMPORT_INITIAL_CANARY_MAX_ROWS) {
    blockers.push(
      `Only ${BULK_IMPORT_INITIAL_CANARY_MAX_ROWS} simulated row may be approved for the initial canary.`
    );
  }

  for (const row of input.eligibleRows) {
    if (row.excluded) {
      blockers.push(`Row ${row.rowNumber} is excluded.`);
    }
    if (!row.sourceLeadEventId) {
      blockers.push(`Row ${row.rowNumber} is missing a normalized Source Intake record.`);
    }
    if (row.deliveryStatus !== "simulated") {
      blockers.push(`Row ${row.rowNumber} has not passed simulation.`);
    }
    if (row.duplicateStatus === "duplicate_review" || row.duplicateStatus === "blocked") {
      blockers.push(`Row ${row.rowNumber} is blocked by duplicate review.`);
    }
    if (row.ghlContactId) {
      blockers.push(`Row ${row.rowNumber} already has a GHL contact ID.`);
    }
  }

  if (blockers.length > 0) {
    return { ok: false, error: "initial_canary_guard_failed", blockers };
  }

  return { ok: true };
}
