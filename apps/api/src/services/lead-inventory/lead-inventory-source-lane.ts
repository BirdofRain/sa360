import type { SourceLeadProvider, SourceLeadEvent } from "@prisma/client";

import { resolveCanonicalSourceLane, type SourceLaneInput } from "../fulfillment-execution/lf2-source-lane.service.js";

/** Maximum rows scanned while lane-filtering import preview candidates. */
export const LEAD_INVENTORY_IMPORT_PREVIEW_MAX_SCAN = 2500;

/** Over-fetch multiplier before canonical lane filtering in import preview. */
export const LEAD_INVENTORY_IMPORT_PREVIEW_OVERFETCH_MULTIPLIER = 5;

const LANE_PROVIDER_NARROWING: Record<string, SourceLeadProvider[]> = {
  leadcapture_io: ["leadcapture_io"],
  facebook_meta_lead_ads: ["facebook"],
  meta_lead_ads: ["facebook"],
  leadconduit_facebook: ["facebook"],
};

export function normalizeRequestedSourceLane(sourceLane: string | undefined): string | null {
  const lane = sourceLane?.trim().toLowerCase();
  return lane ? lane : null;
}

export function narrowProvidersForCanonicalLane(
  sourceLane: string | undefined
): SourceLeadProvider[] | null {
  const lane = normalizeRequestedSourceLane(sourceLane);
  if (!lane) return null;
  return LANE_PROVIDER_NARROWING[lane] ?? null;
}

export function matchesCanonicalSourceLane(
  event: SourceLaneInput,
  requestedLane: string | undefined
): boolean {
  const lane = normalizeRequestedSourceLane(requestedLane);
  if (!lane) return true;
  return resolveCanonicalSourceLane(event) === lane;
}

export function computeImportPreviewFetchBatchSize(limit: number): number {
  return Math.min(
    Math.max(limit, 1) * LEAD_INVENTORY_IMPORT_PREVIEW_OVERFETCH_MULTIPLIER,
    LEAD_INVENTORY_IMPORT_PREVIEW_MAX_SCAN
  );
}

export type ImportPreviewCandidateEvent = Pick<
  SourceLeadEvent,
  | "id"
  | "sourceLeadUid"
  | "sourceProvider"
  | "sourceSystem"
  | "sourceType"
  | "sourceRouteKey"
  | "receivedAt"
  | "normalizedPayloadJson"
  | "enrichmentMetadataJson"
>;
