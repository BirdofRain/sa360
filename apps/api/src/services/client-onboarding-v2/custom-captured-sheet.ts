/**
 * Maps one stored lead onto a published custom campaign tab.
 * Preview and the captured-event test both use this projection.
 * It does not call Google, publish a map, or change a delivery switch.
 */

import {
  applyOperatorAssignments,
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  customRowProjection,
  exactHeader,
  publishBlocker,
  type ColumnAssignment,
} from "../company-sheets-delivery/company-sheets-custom-row.js";

export const CONFIRM_ONE_CUSTOM_SHEETS_ROW = "DELIVER ONE CUSTOM SHEETS TEST ROW";
export const CUSTOM_CAMPAIGN_SHEETS_CONTRACT = "custom_campaign_map" as const;

export function capturedEventTestKey(clientAccountId: string, sourceLeadEventId: string): string {
  return `captured-event-test:${clientAccountId}:${sourceLeadEventId}`;
}

/**
 * A stored lead is an operator dummy only when intake recorded that marker.
 * A confirmed association, a routing match, or an inventory row is not that marker.
 * The synthetic campaign-test identity is a different operation and is refused.
 */
export function isSyntheticCampaignTestEvent(event: {
  id: string;
  sourceLeadId?: string | null;
}): boolean {
  return event.id === "synthetic-campaign-test" || event.sourceLeadId === "synthetic-campaign-test";
}

export function isOperatorCreatedDummyEvent(event: {
  id: string;
  sourceLeadId?: string | null;
  enrichmentMetadataJson: unknown;
}): boolean {
  if (isSyntheticCampaignTestEvent(event)) return false;
  const enrichment = asRecord(event.enrichmentMetadataJson);
  return enrichment?.operatorDummy === true;
}

export type PublishedCampaignMapSnapshot = {
  id: string;
  mapVersion: number;
  spreadsheetId: string;
  worksheetId: number;
  headerSnapshot: string[];
  assignments: unknown;
};

export type CustomCampaignSheetPlan = {
  spreadsheetId: string;
  worksheetId: number;
  worksheetTitle: string;
  schemaVersion: typeof COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA;
  header: string[];
  values: string[];
  deliveryRowId: string;
  sourceLeadEventId: string;
  operatorDummy: boolean;
  warnings: string[];
  contentKey: string;
};

export function planCustomCampaignSheet(input: {
  clientAccountId: string;
  spreadsheetId: string;
  campaign: { worksheetId: number; worksheetTitle: string; schemaVersion: string; header: string[] } | null;
  publishedMap: PublishedCampaignMapSnapshot | null;
  event: {
    id: string;
    sourceLeadId: string | null;
    receivedAt: string;
    normalizedPayloadJson: unknown;
    enrichmentMetadataJson: unknown;
  } | null;
}):
  | { applies: false }
  | { applies: true; ok: true; plan: CustomCampaignSheetPlan }
  | { applies: true; ok: false; statusCode: number; error: string } {
  if (input.campaign?.schemaVersion !== COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA) return { applies: false };
  if (!input.event) return { applies: true, ok: false, statusCode: 409, error: "event_not_client_owned" };
  const map = input.publishedMap;
  if (
    !map ||
    map.spreadsheetId !== input.spreadsheetId ||
    map.worksheetId !== input.campaign.worksheetId
  ) {
    return { applies: true, ok: false, statusCode: 409, error: "mapping_required" };
  }
  if (!exactHeader(map.headerSnapshot, input.campaign.header)) {
    return { applies: true, ok: false, statusCode: 409, error: "header_changed" };
  }
  const sample = formulaSample(map.assignments, map.headerSnapshot.length);
  const applied = applyOperatorAssignments(map.headerSnapshot, sample, map.assignments);
  if (!applied.ok) return { applies: true, ok: false, statusCode: applied.statusCode, error: applied.error };
  const blocked = publishBlocker(applied.assignments);
  if (!blocked.ok) return { applies: true, ok: false, statusCode: blocked.statusCode, error: blocked.error };
  const deliveryRowId = capturedEventTestKey(input.clientAccountId, input.event.id);
  const projected = customRowProjection(applied.assignments, {
    stableRowId: deliveryRowId,
    clientAccountId: input.clientAccountId,
    sourceLeadEventId: input.event.id,
    receivedAt: input.event.receivedAt,
    sourceLeadId: input.event.sourceLeadId,
    normalizedPayload: input.event.normalizedPayloadJson,
  });
  if (!projected || projected.values.length !== map.headerSnapshot.length) {
    return { applies: true, ok: false, statusCode: 409, error: "mapping_required" };
  }
  return {
    applies: true,
    ok: true,
    plan: {
      spreadsheetId: input.spreadsheetId,
      worksheetId: input.campaign.worksheetId,
      worksheetTitle: input.campaign.worksheetTitle,
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
      header: [...map.headerSnapshot],
      values: projected.values,
      deliveryRowId,
      sourceLeadEventId: input.event.id,
      operatorDummy: isOperatorCreatedDummyEvent(input.event),
      warnings: projected.warnings,
      contentKey: `column-map:${map.id}:v${map.mapVersion}`,
    },
  };
}

function formulaSample(assignments: unknown, width: number): string[] {
  const rows = Array.isArray(assignments) ? assignments : [];
  return Array.from({ length: width }, (_, index) => {
    const record = asRecord(rows[index]);
    return record?.formula === true ? "=" : "";
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
