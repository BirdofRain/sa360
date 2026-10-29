/**
 * Read-only preview of one stored lead through the production custom-row mapper.
 * This module does not call Google or GoHighLevel, does not write a cell,
 * and does not insert a test run, delivery job, inventory row, or audit event.
 * A matching stored header is not an independent Google reread, so the
 * result is never delivery-ready.
 */

import type { Prisma, PrismaClient, SourceLeadProvider, SourceLeadSystem, SourceLeadType } from "@prisma/client";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { campaignLeadIdentityFromPayload, companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import {
  applyOperatorAssignments,
  columnLabel,
  customRowValues,
  exactHeader,
  headerFingerprint,
  type ColumnAssignment,
} from "../company-sheets-delivery/company-sheets-custom-row.js";

type Db = PrismaClient | Prisma.TransactionClient;

const PROVIDERS = new Set(["leadcapture_io", "facebook", "goat_leads", "manual_import", "google_sheets", "unknown"]);
const SYSTEMS = new Set([
  "leadcapture_io_legacy",
  "leadcapture_io_nextgen",
  "meta_lead_ads",
  "external_vendor",
  "csv_import",
  "google_sheet_import",
]);
const TYPES = new Set(["webhook", "lead_form", "bulk_import", "api_import", "manual_entry"]);
const PAGE_MAX = 25;

export type ColumnPreviewWarning = { code: string; message: string };

export type StoredLeadColumnPreviewCell = {
  columnLetter: string;
  position: number;
  sheetHeader: string;
  sourceField: string | null;
  sourceHeader: string | null;
  formattedValue: string;
  appended: false | true;
  warnings: ColumnPreviewWarning[];
};

export type StoredLeadPreviewLead = {
  id: string;
  receivedAt: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceType: string;
  label: string;
};

export type StoredLeadColumnPreview = {
  ok: true;
  previewOnly: true;
  deliveryReady: false;
  presentAsDeliveryReady: false;
  googleHeaderIndependentlyReread: false;
  writes: false;
  persisted: false;
  externalCalls: { sheets: false; ghl: false };
  basis: "draft" | "published";
  publishedMapUnchanged: true;
  reasons: string[];
  map: {
    id: string;
    status: string;
    revision: number;
    spreadsheetId: string;
    worksheetId: number;
    headerFingerprint: string;
    headerFingerprintMatchesBinding: boolean;
  };
  lead: StoredLeadPreviewLead;
  columns: StoredLeadColumnPreviewCell[];
  operatorDecisions: ColumnPreviewWarning[];
};

export type PreviewFailure = { ok: false; statusCode: number; error: string; detail?: string };

type Freshness = {
  matchesBinding: boolean;
  staleIndexes: Set<number>;
  reasons: string[];
};

export async function listStoredLeadsForColumnPreview(
  input: { clientAccountId: string; query?: string | null; cursor?: string | null; limit?: number | null },
  db: Db = prisma
): Promise<
  | { ok: true; leads: StoredLeadPreviewLead[]; nextCursor: string | null }
  | PreviewFailure
> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, statusCode: 404, error: "client_not_found" };
  const limit = input.limit == null ? 20 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) {
    return { ok: false, statusCode: 400, error: "invalid_body" };
  }
  const cursor = parseCursor(input.cursor ?? null);
  if (cursor === "invalid") return { ok: false, statusCode: 400, error: "invalid_body" };
  const query = (input.query ?? "").trim();
  if (query.length > 80) return { ok: false, statusCode: 400, error: "invalid_body" };
  const where: Prisma.SourceLeadEventWhereInput = {
    clientAccountIdResolved: clientAccountId,
    ...searchFilter(query),
  };
  if (cursor) {
    where.AND = [
      {
        OR: [
          { receivedAt: { lt: cursor.receivedAt } },
          { AND: [{ receivedAt: cursor.receivedAt }, { id: { lt: cursor.id } }] },
        ],
      },
    ];
  }
  const rows = await db.sourceLeadEvent.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      receivedAt: true,
      sourceProvider: true,
      sourceSystem: true,
      sourceType: true,
      normalizedPayloadJson: true,
    },
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ok: true,
    leads: page.map(presentLead),
    nextCursor: rows.length > limit && last ? `${last.receivedAt.toISOString()}|${last.id}` : null,
  };
}

export async function previewStoredLeadColumnMap(
  input: {
    clientAccountId: string;
    sourceLeadEventId: string;
    spreadsheetId: string;
    worksheetId: number;
    mapId: string;
    basis: "draft" | "published";
    assignments?: unknown;
  },
  db: Db = prisma
): Promise<StoredLeadColumnPreview | PreviewFailure> {
  const clientAccountId = input.clientAccountId.trim();
  const map = await db.clientSheetColumnMap.findFirst({
    where: { id: input.mapId, clientAccountId },
  });
  if (!map) return { ok: false, statusCode: 404, error: "client_not_found", detail: "Column map not found for this client." };
  if (map.spreadsheetId !== input.spreadsheetId || map.worksheetId !== input.worksheetId) {
    return { ok: false, statusCode: 409, error: "map_target_mismatch", detail: "This map belongs to a different spreadsheet or worksheet." };
  }
  if (input.basis === "published" && map.status !== "published") {
    return {
      ok: false,
      statusCode: 409,
      error: "map_not_published",
      detail: "This map is not published. Preview the draft assignments instead. The stored map was not changed.",
    };
  }
  const event = await db.sourceLeadEvent.findUnique({ where: { id: input.sourceLeadEventId } });
  if (!event) return { ok: false, statusCode: 404, error: "event_not_found" };
  if (event.clientAccountIdResolved !== clientAccountId) {
    return { ok: false, statusCode: 403, error: "event_not_client_owned" };
  }
  const header = stringList(map.headerSnapshot);
  const storedAssignments = Array.isArray(map.assignments) ? map.assignments : [];
  const source = input.basis === "draft" ? input.assignments : storedAssignments;
  if (input.basis === "draft" && !Array.isArray(source)) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "A draft preview needs one assignment per header column." };
  }
  const sample = sampleFromAssignments(Array.isArray(source) ? source : []);
  const applied = applyOperatorAssignments(header, sample, source);
  if (!applied.ok) return { ok: false, statusCode: applied.statusCode, error: applied.error, detail: applied.detail };
  const freshness = await headerFreshness(db, clientAccountId, input.spreadsheetId, input.worksheetId, header);
  const leadInput = {
    stableRowId: `preview:${clientAccountId}:${event.id}`,
    clientAccountId,
    sourceLeadEventId: event.id,
    receivedAt: event.receivedAt.toISOString(),
    sourceLeadId: event.sourceLeadId,
    normalizedPayload: event.normalizedPayloadJson,
  };
  const built = buildStoredLeadColumnPreview({
    assignments: applied.assignments,
    lead: leadInput,
    freshness,
    basis: input.basis,
  });
  if (!built.ok) return built;
  return {
    ...built,
    map: {
      id: map.id,
      status: map.status,
      revision: map.revision,
      spreadsheetId: map.spreadsheetId,
      worksheetId: map.worksheetId,
      headerFingerprint: headerFingerprint(header),
      headerFingerprintMatchesBinding: freshness.matchesBinding,
    },
    lead: presentLead(event),
  };
}

export function buildStoredLeadColumnPreview(input: {
  assignments: readonly ColumnAssignment[];
  lead: {
    stableRowId: string;
    clientAccountId: string;
    sourceLeadEventId: string;
    receivedAt: string;
    sourceLeadId: string | null;
    normalizedPayload: unknown;
  };
  freshness: Freshness;
  basis: "draft" | "published";
}):
  | {
      ok: true;
      previewOnly: true;
      deliveryReady: false;
      presentAsDeliveryReady: false;
      googleHeaderIndependentlyReread: false;
      writes: false;
      persisted: false;
      externalCalls: { sheets: false; ghl: false };
      basis: "draft" | "published";
      publishedMapUnchanged: true;
      reasons: string[];
      columns: StoredLeadColumnPreviewCell[];
      operatorDecisions: ColumnPreviewWarning[];
    }
  | PreviewFailure {
  const values = customRowValues(input.assignments, input.lead);
  const v3 = companySheetsCampaignRowValues({ ...input.lead, schemaVersion: "company_sheets_campaign_v3" });
  if (!values || !v3) return { ok: false, statusCode: 409, error: "mapping_required" };
  const byField = new Map(COMPANY_SHEETS_V3_COLUMNS.map((column, index) => [column.sourceField, v3[index] ?? ""]));
  const primaryReason = (byField.get("primary_reason") ?? "").trim();
  const operatorDecisions: ColumnPreviewWarning[] = [];
  const columns = input.assignments.map((column, index) => {
    const formattedValue = values[index] ?? "";
    const warnings: ColumnPreviewWarning[] = [];
    if (column.formula) {
      warnings.push({
        code: "formula_protected",
        message: "This column is formula-protected. The preview does not write it, and an append leaves the cell absent.",
      });
    }
    if (column.decision === "unmapped") {
      warnings.push({ code: "explicitly_unmapped", message: "This column is explicitly unmapped. The new row would leave it blank." });
    }
    if (column.decision === "ambiguous") {
      warnings.push({ code: "ambiguous_mapping", message: "This column is ambiguous. It is not delivery-ready." });
    }
    if (column.decision === "mapped" && !column.formula && formattedValue.trim() === "") {
      warnings.push({
        code: "missing_source_value",
        message: `${column.target?.header ?? column.sheetHeader} has no stored source value.`,
      });
    }
    if (input.freshness.staleIndexes.has(index)) {
      warnings.push({
        code: "stale_mapping",
        message: "The stored binding header at this position does not match the map. These values are not delivery-ready.",
      });
    }
    if (column.target?.sourceField === "primary_concern" && formattedValue.trim() === "" && primaryReason) {
      operatorDecisions.push({
        code: "primary_concern_not_replaced",
        message:
          "Primary Concern is blank. Stored primary_reason was not copied into this column. Replacing it is an operator decision, and this preview does not make that replacement.",
      });
    }
    return {
      columnLetter: columnLabel(index),
      position: index + 1,
      sheetHeader: column.sheetHeader,
      sourceField: column.target?.sourceField ?? null,
      sourceHeader: column.target?.header ?? null,
      formattedValue,
      appended: column.decision === "mapped" && !column.formula && column.transform !== "blank",
      warnings,
    };
  });
  const reasons = [...input.freshness.reasons];
  if (input.basis === "draft") reasons.push("draft_not_published");
  if (input.assignments.some((column) => !column.explicit || column.decision === "ambiguous")) reasons.push("mapping_not_explicit");
  if (!reasons.includes("google_header_not_reread")) reasons.push("google_header_not_reread");
  return {
    ok: true,
    previewOnly: true,
    deliveryReady: false,
    presentAsDeliveryReady: false,
    googleHeaderIndependentlyReread: false,
    writes: false,
    persisted: false,
    externalCalls: { sheets: false, ghl: false },
    basis: input.basis,
    publishedMapUnchanged: true,
    reasons,
    columns,
    operatorDecisions,
  };
}

async function headerFreshness(
  db: Db,
  clientAccountId: string,
  spreadsheetId: string,
  worksheetId: number,
  header: string[]
): Promise<Freshness> {
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  const tab = destination
    ? await db.companySheetsTabContract.findUnique({
        where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      })
    : null;
  const boundHere =
    destination?.spreadsheetId === spreadsheetId && tab?.worksheetId === worksheetId ? stringList(tab.headerContract) : null;
  if (!boundHere || boundHere.length === 0) {
    return { matchesBinding: false, staleIndexes: new Set(), reasons: ["binding_absent", "google_header_not_reread"] };
  }
  if (!exactHeader(boundHere, header)) {
    const staleIndexes = new Set<number>();
    const width = Math.max(boundHere.length, header.length);
    for (let index = 0; index < width; index += 1) {
      if ((boundHere[index] ?? "") !== (header[index] ?? "")) staleIndexes.add(index);
    }
    return { matchesBinding: false, staleIndexes, reasons: ["header_fingerprint_mismatch", "google_header_not_reread"] };
  }
  return { matchesBinding: true, staleIndexes: new Set(), reasons: ["google_header_not_reread"] };
}

function presentLead(event: {
  id: string;
  receivedAt: Date;
  sourceProvider: string;
  sourceSystem: string;
  sourceType: string;
  normalizedPayloadJson: unknown;
}): StoredLeadPreviewLead {
  const identity = campaignLeadIdentityFromPayload(event.normalizedPayloadJson);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(event.receivedAt);
  const who = [initial(identity.firstName), initial(identity.lastName)].filter(Boolean).join(" ");
  const contact = [maskEmail(identity.email), maskPhone(identity.phone)].filter(Boolean).join(" · ");
  return {
    id: event.id,
    receivedAt: event.receivedAt.toISOString(),
    sourceProvider: event.sourceProvider,
    sourceSystem: event.sourceSystem,
    sourceType: event.sourceType,
    label: [when, `${event.sourceProvider}/${event.sourceSystem}`, who, contact].filter(Boolean).join(" · "),
  };
}

function initial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.slice(0, 1).toUpperCase()}.` : "";
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***${digits.slice(-4)}`;
}

function searchFilter(query: string): Prisma.SourceLeadEventWhereInput {
  if (!query) return {};
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(query);
  if (day) {
    const start = new Date(`${query}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { receivedAt: { gte: start, lt: end } };
  }
  const normalized = query.toLowerCase();
  const or: Prisma.SourceLeadEventWhereInput[] = [];
  if (PROVIDERS.has(normalized)) or.push({ sourceProvider: normalized as SourceLeadProvider });
  if (SYSTEMS.has(normalized)) or.push({ sourceSystem: normalized as SourceLeadSystem });
  if (TYPES.has(normalized)) or.push({ sourceType: normalized as SourceLeadType });
  or.push(
    { sourceRouteKey: { contains: query, mode: "insensitive" } },
    { sourceCampaignName: { contains: query, mode: "insensitive" } },
    { sourceFunnelName: { contains: query, mode: "insensitive" } }
  );
  if (/^[A-Za-z0-9_-]{8,80}$/.test(query)) or.push({ id: { startsWith: query } });
  return { OR: or };
}

function parseCursor(value: string | null): { receivedAt: Date; id: string } | null | "invalid" {
  if (!value) return null;
  const splitAt = value.lastIndexOf("|");
  if (splitAt <= 0) return "invalid";
  const receivedAt = new Date(value.slice(0, splitAt));
  const id = value.slice(splitAt + 1);
  if (Number.isNaN(receivedAt.getTime()) || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) return "invalid";
  return { receivedAt, id };
}

function sampleFromAssignments(assignments: readonly unknown[]): string[] {
  return assignments.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? (item as { formula?: unknown }) : null;
    return record?.formula === true ? "=" : "";
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : ""));
}
