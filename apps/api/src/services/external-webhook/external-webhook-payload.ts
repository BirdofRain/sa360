import { createHash } from "node:crypto";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import {
  CAMPAIGN_DOB_AGE_CONFLICT_WARNING,
  CAMPAIGN_DOB_AGE_FUTURE_WARNING,
  CAMPAIGN_DOB_AGE_REFERENCE_UNAVAILABLE_WARNING,
  projectCampaignDobAge,
  type CampaignDobAgePreview,
} from "../consumer-age/campaign-dob-age.js";
import {
  columnMapContentKey,
  customRowProjection,
  type ColumnAssignment,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import {
  companySheetsCampaignRowValues,
  type CampaignSheetLeadInput,
} from "../company-sheets-delivery/company-sheets-campaign-row.js";
import {
  EXTERNAL_WEBHOOK_DOES_NOT_PROVE,
  EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION,
  externalWebhookIdempotencyKey,
  type ExternalWebhookReceipt,
} from "./external-webhook-contract.js";

/**
 * Pure canonical body for one external webhook POST.
 * Values come from the company Sheets v3 row, or from one published map via
 * customRowProjection. This module does not query Postgres and does not send.
 *
 * Published-map selection matches findPublishedColumnMap: a published funnel
 * scope wins, otherwise a published shared scope. Pass that row in. A draft
 * is not a selection.
 */

export type ExternalWebhookDestinationKindName = "ghl_inbound" | "external_https";

export type PublishedColumnMapSnapshot = {
  id: string;
  mapVersion: number;
  sourceScope: string;
  status: string;
  assignments: readonly ColumnAssignment[];
};

export type ExternalWebhookPayload = {
  contractVersion: typeof EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION;
  idempotencyKey: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationKind: ExternalWebhookDestinationKindName;
  destinationRevision: number;
  mapping: {
    mode: "v3_canonical" | "published_column_map";
    baseSchemaVersion: typeof COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3;
    columnMapId: string | null;
    columnMapVersion: number | null;
    contentKey: string | null;
    sourceScope: string | null;
  };
  fields: Record<string, string>;
  columns: Array<{ sheetHeader: string; sourceField: string | null; value: string }>;
  dobAge: CampaignDobAgePreview;
  warnings: string[];
};

export type ExternalWebhookProjection = {
  payload: ExternalWebhookPayload;
  canonicalJson: string;
  payloadSha256: string;
};

export function selectPublishedColumnMap<T extends { status: string }>(input: {
  funnel: T | null;
  shared: T | null;
}): T | null {
  if (input.funnel?.status === "published") return input.funnel;
  if (input.shared?.status === "published") return input.shared;
  return null;
}

export function projectExternalWebhookPayload(input: {
  destinationKind: ExternalWebhookDestinationKindName;
  destinationRevision: number;
  lead: CampaignSheetLeadInput;
  publishedMap?: PublishedColumnMapSnapshot | null;
}): { ok: true; projection: ExternalWebhookProjection } | { ok: false; code: string } {
  if (!Number.isInteger(input.destinationRevision) || input.destinationRevision < 1) {
    return { ok: false, code: "destination_revision_invalid" };
  }
  const idempotencyKey = externalWebhookIdempotencyKey(input.lead.clientAccountId, input.lead.sourceLeadEventId);
  const directDob = projectCampaignDobAge({
    normalizedPayload: input.lead.normalizedPayload,
    receivedAt: input.lead.receivedAt,
  });
  const map = input.publishedMap ?? null;
  const projected = map ? projectPublished(input.lead, map, directDob) : projectV3(input.lead, directDob);
  if (!projected.ok) return projected;

  const payload: ExternalWebhookPayload = {
    contractVersion: EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION,
    idempotencyKey,
    clientAccountId: input.lead.clientAccountId,
    sourceLeadEventId: input.lead.sourceLeadEventId,
    destinationKind: input.destinationKind,
    destinationRevision: input.destinationRevision,
    mapping: projected.mapping,
    fields: projected.fields,
    columns: projected.columns,
    dobAge: projected.dobAge,
    warnings: projected.warnings,
  };
  const canonical = canonicalJson(payload);
  return {
    ok: true,
    projection: {
      payload,
      canonicalJson: canonical,
      payloadSha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
    },
  };
}

export type ExternalWebhookAttemptInsert = {
  idempotencyKey: string;
  clientAccountId: string;
  destinationId: string;
  sourceLeadEventId: string;
  kind: ExternalWebhookDestinationKindName;
  destinationRevision: number;
  endpointHost: string;
  endpointUrlFingerprint: string;
  mappingMode: "v3_canonical" | "published_column_map";
  columnMapId: string | null;
  columnMapVersion: number | null;
  columnMapContentKey: string | null;
  columnMapSourceScope: string | null;
  payloadCanonicalJson: string;
  payloadSha256: string;
  state: "recorded";
  outcome: null;
  httpStatus: null;
  requestLeftSa360: false;
  proves: [];
  doesNotProve: typeof EXTERNAL_WEBHOOK_DOES_NOT_PROVE;
};

/** Row a later intake hook inserts. The payload bytes are already frozen. */
export function buildExternalWebhookAttemptRecord(input: {
  destinationId: string;
  endpointHost: string;
  endpointUrlFingerprint: string;
  projection: ExternalWebhookProjection;
}): { ok: true; record: ExternalWebhookAttemptInsert } | { ok: false; code: string } {
  const payload = input.projection.payload;
  if (canonicalJson(payload) !== input.projection.canonicalJson) {
    return { ok: false, code: "canonical_json_drift" };
  }
  const digest = createHash("sha256").update(input.projection.canonicalJson, "utf8").digest("hex");
  if (digest !== input.projection.payloadSha256) return { ok: false, code: "payload_hash_drift" };
  return {
    ok: true,
    record: {
      idempotencyKey: payload.idempotencyKey,
      clientAccountId: payload.clientAccountId,
      destinationId: input.destinationId,
      sourceLeadEventId: payload.sourceLeadEventId,
      kind: payload.destinationKind,
      destinationRevision: payload.destinationRevision,
      endpointHost: input.endpointHost,
      endpointUrlFingerprint: input.endpointUrlFingerprint,
      mappingMode: payload.mapping.mode,
      columnMapId: payload.mapping.columnMapId,
      columnMapVersion: payload.mapping.columnMapVersion,
      columnMapContentKey: payload.mapping.contentKey,
      columnMapSourceScope: payload.mapping.sourceScope,
      payloadCanonicalJson: input.projection.canonicalJson,
      payloadSha256: input.projection.payloadSha256,
      state: "recorded",
      outcome: null,
      httpStatus: null,
      requestLeftSa360: false,
      proves: [],
      doesNotProve: EXTERNAL_WEBHOOK_DOES_NOT_PROVE,
    },
  };
}

/** Fields a later sender may change on a recorded attempt. Frozen columns stay put. */
export function externalWebhookReceiptUpdate(receipt: ExternalWebhookReceipt): {
  state: "attempted";
  outcome: ExternalWebhookReceipt["outcome"];
  httpStatus: number | null;
  requestLeftSa360: boolean;
  proves: ExternalWebhookReceipt["proves"];
  doesNotProve: ExternalWebhookReceipt["doesNotProve"];
} {
  return {
    state: "attempted",
    outcome: receipt.outcome,
    httpStatus: receipt.httpStatus,
    requestLeftSa360: receipt.requestLeftSa360,
    proves: receipt.proves,
    doesNotProve: receipt.doesNotProve,
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function projectV3(
  lead: CampaignSheetLeadInput,
  directDob: CampaignDobAgePreview
):
  | {
      ok: true;
      mapping: ExternalWebhookPayload["mapping"];
      fields: Record<string, string>;
      columns: ExternalWebhookPayload["columns"];
      dobAge: CampaignDobAgePreview;
      warnings: string[];
    }
  | { ok: false; code: string } {
  const values = companySheetsCampaignRowValues({
    ...lead,
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  });
  if (!values || values.length !== COMPANY_SHEETS_V3_COLUMNS.length) {
    return { ok: false, code: "v3_row_unavailable" };
  }
  const fields: Record<string, string> = {};
  const columns = COMPANY_SHEETS_V3_COLUMNS.map((column, index) => {
    const value = values[index] ?? "";
    if (Object.prototype.hasOwnProperty.call(fields, column.sourceField) && fields[column.sourceField] !== value) {
      return null;
    }
    fields[column.sourceField] = value;
    return { sheetHeader: column.header, sourceField: column.sourceField, value };
  });
  if (columns.some((column) => column === null)) return { ok: false, code: "v3_field_conflict" };
  if (fields.date_of_birth !== directDob.dateOfBirth || fields.consumer_age !== directDob.age) {
    return { ok: false, code: "dob_age_diverged_from_sheet_row" };
  }
  return {
    ok: true,
    mapping: {
      mode: "v3_canonical",
      baseSchemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      columnMapId: null,
      columnMapVersion: null,
      contentKey: null,
      sourceScope: null,
    },
    fields,
    columns: columns as ExternalWebhookPayload["columns"],
    dobAge: directDob,
    warnings: dobWarnings(directDob),
  };
}

function projectPublished(
  lead: CampaignSheetLeadInput,
  map: PublishedColumnMapSnapshot,
  directDob: CampaignDobAgePreview
):
  | {
      ok: true;
      mapping: ExternalWebhookPayload["mapping"];
      fields: Record<string, string>;
      columns: ExternalWebhookPayload["columns"];
      dobAge: CampaignDobAgePreview;
      warnings: string[];
    }
  | { ok: false; code: string } {
  if (map.status !== "published") return { ok: false, code: "published_map_required" };
  if (!map.id.trim() || !Number.isInteger(map.mapVersion) || map.mapVersion < 1) {
    return { ok: false, code: "published_map_version_invalid" };
  }
  if (!map.sourceScope.trim()) return { ok: false, code: "published_map_scope_invalid" };
  const projected = customRowProjection(map.assignments, lead);
  if (!projected) return { ok: false, code: "published_map_unprojectable" };
  if (!sameDobAge(projected.dobAge, directDob)) return { ok: false, code: "dob_age_diverged_from_sheet_row" };
  const fields: Record<string, string> = {};
  let mapped = 0;
  const columns: ExternalWebhookPayload["columns"] = [];
  for (let index = 0; index < map.assignments.length; index += 1) {
    const column = map.assignments[index];
    const value = projected.values[index] ?? "";
    if (!column) return { ok: false, code: "published_map_unprojectable" };
    const sourceField =
      column.decision === "mapped" && column.target && column.transform !== "blank"
        ? column.target.sourceField
        : null;
    columns.push({ sheetHeader: column.sheetHeader, sourceField, value });
    if (!sourceField) continue;
    mapped += 1;
    if (Object.prototype.hasOwnProperty.call(fields, sourceField) && fields[sourceField] !== value) {
      return { ok: false, code: "published_map_field_conflict" };
    }
    fields[sourceField] = value;
  }
  if (mapped === 0) return { ok: false, code: "published_map_empty" };
  const contentKey = columnMapContentKey(map.id, map.mapVersion);
  return {
    ok: true,
    mapping: {
      mode: "published_column_map",
      baseSchemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      columnMapId: map.id,
      columnMapVersion: map.mapVersion,
      contentKey,
      sourceScope: map.sourceScope,
    },
    fields,
    columns,
    dobAge: directDob,
    warnings: [...projected.warnings],
  };
}

function dobWarnings(dobAge: CampaignDobAgePreview): string[] {
  const warnings: string[] = [];
  if (dobAge.conflict) warnings.push(CAMPAIGN_DOB_AGE_CONFLICT_WARNING);
  if (dobAge.ageUnavailableReason === "no_valid_reference") {
    warnings.push(CAMPAIGN_DOB_AGE_REFERENCE_UNAVAILABLE_WARNING);
  }
  if (dobAge.ageUnavailableReason === "future_date_of_birth") warnings.push(CAMPAIGN_DOB_AGE_FUTURE_WARNING);
  return warnings;
}

function sameDobAge(left: CampaignDobAgePreview, right: CampaignDobAgePreview): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortJson(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("External webhook canonical JSON refused a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === undefined) throw new Error("External webhook canonical JSON refused an empty array entry.");
      return sortJson(item);
    });
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      sorted[key] = sortJson(record[key]);
    }
    return sorted;
  }
  throw new Error("External webhook canonical JSON refused a non-JSON value.");
}
