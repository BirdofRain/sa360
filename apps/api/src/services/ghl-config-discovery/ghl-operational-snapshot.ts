/**
 * Operational versus informational use of a stored GoHighLevel snapshot.
 *
 * Informational reads may show the newest complete snapshot after a later
 * refresh failed. That view is historical. It is not authorization.
 *
 * A configuration save, workflow retarget, owner assignment, canary preflight,
 * or readiness claim of READY requires the newest row for the exact location
 * to be a complete discovery. The row must be no older than 24 hours and no
 * more than five minutes ahead of this process. Those are the same limits as
 * `GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS` and
 * `GHL_DESTINATION_CONFIG_SNAPSHOT_FUTURE_SKEW_MS`. An older complete snapshot
 * is not substituted. A failed refresh does not clear or rewrite stored
 * destination data and does not turn delivery off.
 *
 * The location advisory lock is held across the authoritative read and the
 * operational write. Snapshot inserts take the same lock, so a failed refresh
 * cannot commit between that read and the write.
 *
 * Left unchanged on purpose:
 * - Discovery load already returns a previously captured snapshot and does not
 *   write destination state.
 * - The Team Workspace configuration request already rejects a newest row that
 *   is not a fresh complete discovery. This module does not apply that request.
 * - Onboarding v2 `loadStoredWorkflowDiscovery` still reads the chronological
 *   newest row, and `saveSelectTimeZone` can write a workflow id. That route
 *   stays unwired unless its dependencies are injected, and its flag stays
 *   default-off.
 * - Company Sheets setup is not a reader of this snapshot.
 */

import type { GhlLocationConfigSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  assessGhlDestinationSnapshotFreshness,
  GHL_DESTINATION_CONFIG_SNAPSHOT_FUTURE_SKEW_MS,
  GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS,
} from "../ghl-destination-config-request.js";
import {
  isUsableGhlLocationConfigSnapshot,
  previouslyCapturedSnapshotMessage,
  readGhlSnapshotOutcome,
  type GhlSnapshotOutcome,
} from "../../lib/ghl-config-snapshot-validity.js";
import {
  findLatestUsableGhlLocationConfigSnapshot,
  findNewestGhlLocationConfigSnapshot,
  lockGhlLocationSnapshot,
} from "../../repositories/ghl-location-config-snapshot.repository.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery.types.js";
import { detectSa360RequiredCustomFields } from "./ghl-config-discovery.service.js";
import { snapshotToDiscoveryResult } from "./ghl-config-discovery.present.js";

export const GHL_OPERATIONAL_SNAPSHOT_MAX_AGE_MS = GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS;
export const GHL_OPERATIONAL_SNAPSHOT_FUTURE_SKEW_MS = GHL_DESTINATION_CONFIG_SNAPSHOT_FUTURE_SKEW_MS;

export type OperationalSnapshotCode =
  | "SNAPSHOT_MISSING"
  | "SNAPSHOT_NOT_CURRENT"
  | "SNAPSHOT_EXPIRED"
  | "SNAPSHOT_FUTURE"
  | "SNAPSHOT_WRONG_LOCATION"
  | "SNAPSHOT_BUSY";

export type OperationalSnapshotRejection = {
  error: string;
  code: OperationalSnapshotCode;
};

export type OperationalSnapshotAssessment =
  | { state: "current" }
  | { state: "missing" }
  | { state: "wrong_location" }
  | { state: "failed"; outcome: GhlSnapshotOutcome | "legacy_failure"; reconnect: boolean }
  | { state: "expired" }
  | { state: "future" }
  | { state: "unreadable_timestamp" };

type SnapshotEvidence = {
  locationId: string;
  fetchedAt: Date | string;
  errorsJson?: unknown;
  warningsJson?: unknown;
};

export class OperationalSnapshotAbort extends Error {
  constructor(readonly result: OperationalSnapshotRejection) {
    super(result.error);
  }
}

export type GhlOperationalSaveDeps = {
  now?: Date;
  /**
   * Test-only hook. It runs after the location lock and before the snapshot
   * that authorizes the write is read. Production routes do not pass it.
   */
  afterLocationLock?: (tx: Prisma.TransactionClient) => Promise<void>;
};

const SAVED_UNCHANGED = "The existing configuration was left unchanged.";

export function assessOperationalGhlSnapshot(
  row: SnapshotEvidence | null,
  locationId: string,
  now: Date
): OperationalSnapshotAssessment {
  if (!row) return { state: "missing" };
  if (row.locationId.trim() !== locationId.trim()) return { state: "wrong_location" };
  if (!isUsableGhlLocationConfigSnapshot(row)) {
    const marker = readGhlSnapshotOutcome(row.errorsJson) ?? readGhlSnapshotOutcome(row.warningsJson);
    return {
      state: "failed",
      outcome: marker?.discoveryOutcome ?? "legacy_failure",
      reconnect: marker?.discoveryOutcome === "authentication",
    };
  }
  const freshness = assessGhlDestinationSnapshotFreshness(row.fetchedAt, now);
  if (freshness === "expired") return { state: "expired" };
  if (freshness === "future") return { state: "future" };
  if (freshness === "malformed") return { state: "unreadable_timestamp" };
  return { state: "current" };
}

export function operationalSaveRejection(
  assessment: Exclude<OperationalSnapshotAssessment, { state: "current" }>
): OperationalSnapshotRejection {
  switch (assessment.state) {
    case "missing":
      return {
        code: "SNAPSHOT_MISSING",
        error: `No GoHighLevel discovery snapshot is stored for this location. Refresh discovery before saving. ${SAVED_UNCHANGED}`,
      };
    case "wrong_location":
      return {
        code: "SNAPSHOT_WRONG_LOCATION",
        error: `The discovery snapshot is for a different GoHighLevel location, so it cannot authorize this change. Refresh discovery for this location. ${SAVED_UNCHANGED}`,
      };
    case "expired":
      return {
        code: "SNAPSHOT_EXPIRED",
        error: `The latest complete GoHighLevel discovery for this location is older than 24 hours. Refresh discovery before saving. ${SAVED_UNCHANGED}`,
      };
    case "future":
      return {
        code: "SNAPSHOT_FUTURE",
        error: `The latest GoHighLevel discovery timestamp is more than five minutes ahead of this server. Refresh discovery before saving. ${SAVED_UNCHANGED}`,
      };
    case "unreadable_timestamp":
      return {
        code: "SNAPSHOT_NOT_CURRENT",
        error: `The latest GoHighLevel discovery timestamp could not be read, so it cannot authorize this change. Refresh discovery. ${SAVED_UNCHANGED}`,
      };
    default:
      return {
        code: "SNAPSHOT_NOT_CURRENT",
        error: assessment.reconnect
          ? `The latest GoHighLevel discovery for this location failed because the credentials were rejected. Reconnect the location, then refresh discovery. This change was not saved, and the existing configuration was left unchanged.`
          : `The latest GoHighLevel discovery for this location did not complete, so it cannot authorize this change. Refresh discovery and try again. ${SAVED_UNCHANGED}`,
      };
  }
}

export function canaryDiscoveryBlocker(
  assessment: OperationalSnapshotAssessment,
  mappedFieldIds: string[],
  discoveredFields: GhlDiscoveredCustomField[]
): { kind: "current" | "unavailable" | "stale" | "missing_fields"; blocker: string | null } {
  if (assessment.state === "current") {
    const present = new Set(
      discoveredFields
        .map((field) => field.id?.trim())
        .filter((id): id is string => Boolean(id))
    );
    const absent = [...new Set(mappedFieldIds.map((id) => id.trim()).filter(Boolean))].filter(
      (id) => !present.has(id)
    );
    if (absent.length === 0) return { kind: "current", blocker: null };
    return {
      kind: "missing_fields",
      blocker: `Current GoHighLevel discovery does not include mapped custom field id(s): ${absent.join(", ")}. Those fields are absent from this discovery, which is separate from a failed refresh. No canary was started.`,
    };
  }
  if (assessment.state === "expired" || assessment.state === "future" || assessment.state === "unreadable_timestamp") {
    return {
      kind: "stale",
      blocker:
        "The latest complete GoHighLevel discovery for this location is not fresh enough to authorize a canary. Custom fields were not treated as missing. Refresh discovery. No canary was started.",
    };
  }
  if (assessment.state === "failed" && assessment.reconnect) {
    return {
      kind: "unavailable",
      blocker:
        "GoHighLevel discovery is not available for this location because the credentials were rejected. Custom fields were not checked, and this is not a finding that fields are missing. Reconnect the location and refresh discovery. No canary was started.",
    };
  }
  return {
    kind: "unavailable",
    blocker:
      "GoHighLevel discovery is not available for this location, so custom fields were not checked. This is not a finding that fields are missing. Refresh discovery before a canary. No canary was started.",
  };
}

export type InformationalGhlSnapshot = {
  evidence: "current" | "historical" | "unavailable";
  current: boolean;
  stale: boolean;
  reconnect: boolean;
  verification: "cached" | "previously_captured" | "unavailable";
  snapshot: GhlLocationConfigSnapshot | null;
  note: string | null;
};

export async function readInformationalGhlLocationSnapshot(
  locationId: string,
  now: Date = new Date()
): Promise<InformationalGhlSnapshot> {
  const trimmed = locationId.trim();
  const [newest, usable] = await Promise.all([
    findNewestGhlLocationConfigSnapshot(trimmed),
    findLatestUsableGhlLocationConfigSnapshot(trimmed),
  ]);
  const newestAssessment = assessOperationalGhlSnapshot(newest, trimmed, now);
  if (newestAssessment.state === "current" && newest) {
    return {
      evidence: "current",
      current: true,
      stale: false,
      reconnect: false,
      verification: "cached",
      snapshot: newest,
      note: null,
    };
  }
  const historical = usable && usable.locationId.trim() === trimmed ? usable : null;
  if (!historical) {
    const reconnect = newestAssessment.state === "failed" && newestAssessment.reconnect;
    return {
      evidence: "unavailable",
      current: false,
      stale: false,
      reconnect,
      verification: "unavailable",
      snapshot: null,
      note: unavailableNote(newestAssessment),
    };
  }
  const superseded = !newest || newest.id !== historical.id;
  const stale = newestAssessment.state !== "current";
  return {
    evidence: "historical",
    current: false,
    stale,
    reconnect: newestAssessment.state === "failed" && newestAssessment.reconnect,
    verification: "previously_captured",
    snapshot: historical,
    note: historicalNote(newestAssessment, superseded),
  };
}

export function informationalDiscoverySummary(
  view: InformationalGhlSnapshot,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = {
    snapshotVerification: view.verification,
    snapshotCurrent: view.current,
    discoveryEvidence: view.evidence,
    discoveryNote: view.note,
    ...extra,
  };
  if (!view.snapshot) {
    return {
      ...base,
      fetchedAt: null,
      pipelineCount: null,
      workflowCount: null,
      requiredFieldsInstalled: null,
      missingRequiredFields: [],
      sa360FieldMapping: null,
    };
  }
  const fields = detectSa360RequiredCustomFields(
    (view.snapshot.customFieldsJson as GhlDiscoveredCustomField[]) ?? []
  );
  const discovery = snapshotToDiscoveryResult(view.snapshot, fields);
  return {
    ...base,
    fetchedAt: discovery.fetchedAt,
    pipelineCount: discovery.pipelines.length,
    workflowCount: discovery.workflows.length,
    requiredFieldsInstalled: view.current ? discovery.requiredFields.requiredFieldsInstalled : null,
    missingRequiredFields: view.current ? discovery.requiredFields.missingRequiredFields : [],
    historicalRequiredFieldsInstalled: discovery.requiredFields.requiredFieldsInstalled,
    historicalMissingRequiredFields: discovery.requiredFields.missingRequiredFields,
    sa360FieldMapping: discovery.sa360FieldMapping,
  };
}

export async function withCurrentOperationalSnapshot<T>(
  locationId: string,
  deps: GhlOperationalSaveDeps,
  fn: (tx: Prisma.TransactionClient, snapshot: GhlLocationConfigSnapshot) => Promise<T>
): Promise<{ ok: true; value: T } | OperationalSnapshotRejection> {
  const now = deps.now ?? new Date();
  try {
    const value = await prisma.$transaction(async (tx) => {
      await lockGhlLocationSnapshot(tx, locationId);
      if (deps.afterLocationLock) await deps.afterLocationLock(tx);
      const newest = await tx.ghlLocationConfigSnapshot.findFirst({
        where: { locationId: locationId.trim() },
        orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
      });
      const assessment = assessOperationalGhlSnapshot(newest, locationId, now);
      if (assessment.state !== "current" || !newest) {
        throw new OperationalSnapshotAbort(
          operationalSaveRejection(assessment.state === "current" ? { state: "missing" } : assessment)
        );
      }
      return fn(tx, newest);
    }, { timeout: 15_000 });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof OperationalSnapshotAbort) return error.result;
    if (isLockTimeout(error)) {
      return {
        code: "SNAPSHOT_BUSY",
        error: `GoHighLevel discovery for this location is being refreshed. Retry the save after that refresh finishes. ${SAVED_UNCHANGED}`,
      };
    }
    throw error;
  }
}

function unavailableNote(assessment: OperationalSnapshotAssessment): string {
  if (assessment.state === "failed" && assessment.reconnect) {
    return "No usable GoHighLevel snapshot is stored. The latest refresh rejected this location's credentials. Reconnect the location and refresh discovery. Field presence was not verified.";
  }
  if (assessment.state === "failed") {
    return "No usable GoHighLevel snapshot is stored. The latest refresh did not complete. Refresh discovery. Field presence was not verified.";
  }
  if (assessment.state === "missing") {
    return "No GoHighLevel discovery snapshot is stored for this location. Refresh discovery before treating readiness as known.";
  }
  return "GoHighLevel discovery for this location cannot be verified. Refresh discovery.";
}

function historicalNote(assessment: OperationalSnapshotAssessment, superseded: boolean): string {
  if (assessment.state === "expired") {
    return "The latest complete GoHighLevel discovery is older than 24 hours. It is historical and is not current verification.";
  }
  if (assessment.state === "future" || assessment.state === "unreadable_timestamp") {
    return "The latest GoHighLevel discovery timestamp cannot authorize a current claim. Any earlier snapshot shown here is historical.";
  }
  if (superseded || assessment.state === "failed") {
    const summary =
      assessment.state === "failed" && assessment.reconnect
        ? "The latest refresh rejected this location's credentials."
        : "The latest GoHighLevel discovery did not succeed.";
    return previouslyCapturedSnapshotMessage(summary);
  }
  return "This GoHighLevel snapshot is not current verification.";
}

function isLockTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /lock timeout|55P03/i.test(message);
}
