import { HistoricalOwnershipPreviewError } from "./historical-ownership-preview-error.js";

export const HISTORICAL_OWNERSHIP_MAX_IDENTITIES = 50;
export const HISTORICAL_CATALOG_MAX_PAGE_SIZE = 50;
export const HISTORICAL_CATALOG_DEFAULT_PAGE_SIZE = 25;
export const HISTORICAL_CATALOG_MAX_PAGE = 200;
export const HISTORICAL_MAPPING_MAX_CHARS = 65_536;
export const PROTECTED_RESERVATION_ORDER_NUMBER = "LO-1053";

const CATALOG_KEYS = new Set(["lotKey", "importRequest", "niche", "label", "page", "pageSize"]);
const PREVIEW_KEYS = new Set([
  "scopeType",
  "scopeKey",
  "proposals",
  "campaigns",
  "mappingText",
  "proposedOriginClientAccountId",
]);
const PROPOSAL_KEYS = new Set(["normalizedLabel", "originClientAccountId"]);
const CAMPAIGN_KEYS = new Set(["lotKey", "importRequest", "normalizedLabel", "originClientAccountId"]);
const HEADER_NAMES = new Set([
  "lotkey",
  "importrequest",
  "import",
  "normalizedlabel",
  "label",
  "originclientaccountid",
  "origin",
]);
const CONTACT_HEADERS = new Set([
  "phone",
  "email",
  "firstname",
  "lastname",
  "name",
  "contact",
  "csvcontent",
  "beneficiary",
  "dateofbirth",
]);

const EMAILISH = /@/;
const PHONEISH = /(?:\+\d{8,}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/;

export type CatalogRequest = {
  lotKey: string | null;
  importRequest: string | null;
  niche: string | null;
  label: string | null;
  page: number;
  pageSize: number;
};

export type CampaignIdentity = {
  ordinal: number;
  lotKey: string | null;
  importRequest: string | null;
  normalizedLabel: string;
  originClientAccountIds: string[];
  ambiguousScope: boolean;
};

export type ParsedPreviewRequest = {
  identities: CampaignIdentity[];
  scopeMode: "single_scope" | "campaigns";
  scopeType: "inventory_lot" | "import_request";
  scopeKey: string;
};

type ScopeProposal = {
  scopeType: "inventory_lot" | "import_request";
  scopeKey: string;
  normalizedLabel: string;
  originClientAccountId: string;
};

type ExplicitCampaign = {
  lotKey: string;
  importRequest: string;
  normalizedLabel: string;
  originClientAccountId: string;
};

/** Trim and collapse internal whitespace. Case stays significant. Empty becomes null. */
export function normalizeJulyCampaignLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const collapsed = value.trim().replace(/\s+/g, " ");
  return collapsed.length === 0 ? null : collapsed;
}

export function containsContactLikeText(value: string): boolean {
  return EMAILISH.test(value) || PHONEISH.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function fail(failureCode: string): never {
  throw new HistoricalOwnershipPreviewError(failureCode);
}

function objectRecord(value: unknown, failureCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(failureCode);
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, failureCode: string): void {
  for (const key of Object.keys(record)) {
    if (key === "confirm" || key === "confirmationPhrase" || key === "confirmation") {
      fail("historical_ownership_confirmation_not_available");
    }
    if (!allowed.has(key)) fail(failureCode);
  }
}

function parseScopeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > 200) return null;
  if (value !== value.trim() || /\s/.test(value)) return null;
  if (value === "(none)" || value === "(blank)") return null;
  if (containsContactLikeText(value)) return null;
  return value;
}

function parseClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) return null;
  return value;
}

function parseLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeJulyCampaignLabel(value);
  if (!normalized || normalized.length > max) return null;
  if (containsContactLikeText(normalized)) return null;
  return normalized;
}

export function parseHistoricalCatalogRequest(body: unknown): CatalogRequest {
  const record = objectRecord(body, "historical_campaign_catalog_invalid");
  rejectUnknown(record, CATALOG_KEYS, "historical_campaign_catalog_invalid");

  const lotKey = record.lotKey == null || record.lotKey === "" ? null : parseScopeKey(record.lotKey);
  const importRequest =
    record.importRequest == null || record.importRequest === "" ? null : parseScopeKey(record.importRequest);
  if (record.lotKey != null && record.lotKey !== "" && !lotKey) fail("historical_campaign_catalog_invalid");
  if (record.importRequest != null && record.importRequest !== "" && !importRequest) {
    fail("historical_campaign_catalog_invalid");
  }
  if (!lotKey && !importRequest) fail("historical_campaign_catalog_scope_required");

  let niche: string | null = null;
  if (record.niche != null && record.niche !== "") {
    if (typeof record.niche !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(record.niche)) {
      fail("historical_campaign_catalog_invalid");
    }
    niche = record.niche;
  }

  let label: string | null = null;
  if (record.label != null && record.label !== "") {
    label = parseLabel(record.label, 120);
    if (!label) fail("historical_campaign_catalog_invalid");
  }

  const page = record.page == null ? 1 : record.page;
  const pageSize = record.pageSize == null ? HISTORICAL_CATALOG_DEFAULT_PAGE_SIZE : record.pageSize;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > HISTORICAL_CATALOG_MAX_PAGE) {
    fail("historical_campaign_catalog_invalid");
  }
  if (
    typeof pageSize !== "number" ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > HISTORICAL_CATALOG_MAX_PAGE_SIZE
  ) {
    fail("historical_campaign_catalog_invalid");
  }
  if ((page - 1) * pageSize > 5_000) fail("historical_campaign_catalog_invalid");

  return { lotKey, importRequest, niche, label, page, pageSize };
}

function parseMappingText(text: string, defaultClient: string | null): ExplicitCampaign[] {
  if (text.length > HISTORICAL_MAPPING_MAX_CHARS || containsContactLikeText(text)) {
    fail("mapping_rejected");
  }
  const rows = parseCsv(text);
  if (rows.length === 0) fail("mapping_rejected");
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const headerRow = header.some((cell) => HEADER_NAMES.has(cell));
  if (header.some((cell) => CONTACT_HEADERS.has(cell))) fail("mapping_rejected");
  const data = headerRow ? rows.slice(1) : rows;
  if (data.length === 0 || data.length > HISTORICAL_OWNERSHIP_MAX_IDENTITIES) fail("mapping_rejected");

  const index = (names: string[], fallback: number): number => {
    if (!headerRow) return fallback;
    for (const name of names) {
      const found = header.indexOf(name);
      if (found >= 0) return found;
    }
    return -1;
  };
  const lotIndex = index(["lotkey"], 0);
  const importIndex = index(["importrequest", "import"], 1);
  const labelIndex = index(["normalizedlabel", "label"], 2);
  const originIndex = index(["originclientaccountid", "origin"], 3);
  if (lotIndex < 0 || importIndex < 0 || labelIndex < 0) fail("mapping_rejected");

  return data.map((row) => {
    if (row.length > 4) fail("mapping_rejected");
    const lotKey = parseScopeKey(row[lotIndex] ?? "");
    const importRequest = parseScopeKey(row[importIndex] ?? "");
    const normalizedLabel = parseLabel(row[labelIndex] ?? "", 300);
    const rawOrigin = originIndex >= 0 ? (row[originIndex] ?? "").trim() : "";
    const originClientAccountId = rawOrigin ? parseClientId(rawOrigin) : defaultClient;
    if (!lotKey || !importRequest || !normalizedLabel || !originClientAccountId) fail("mapping_rejected");
    return { lotKey, importRequest, normalizedLabel, originClientAccountId };
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (quoted) fail("mapping_rejected");
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function campaignKey(lotKey: string, importRequest: string, normalizedLabel: string): string {
  return `${lotKey}\n${importRequest}\n${normalizedLabel}`;
}

export function parseHistoricalOwnershipPreviewRequest(body: unknown): {
  explicit: ExplicitCampaign[];
  scopeProposals: ScopeProposal[];
  scopeMode: "single_scope" | "campaigns";
  scopeType: "inventory_lot" | "import_request" | null;
  scopeKey: string | null;
} {
  const record = objectRecord(body, "historical_ownership_preview_invalid");
  rejectUnknown(record, PREVIEW_KEYS, "historical_ownership_preview_invalid");

  const defaultClient =
    record.proposedOriginClientAccountId == null
      ? null
      : parseClientId(record.proposedOriginClientAccountId);
  if (record.proposedOriginClientAccountId != null && !defaultClient) {
    fail("historical_ownership_preview_invalid");
  }

  const explicit: ExplicitCampaign[] = [];
  if (record.campaigns != null) {
    if (!Array.isArray(record.campaigns)) fail("historical_ownership_preview_invalid");
    for (const entry of record.campaigns) {
      const row = objectRecord(entry, "historical_ownership_preview_invalid");
      rejectUnknown(row, CAMPAIGN_KEYS, "historical_ownership_preview_invalid");
      const lotKey = parseScopeKey(row.lotKey);
      const importRequest = parseScopeKey(row.importRequest);
      const normalizedLabel = parseLabel(row.normalizedLabel, 300);
      const origin =
        row.originClientAccountId == null ? defaultClient : parseClientId(row.originClientAccountId);
      if (!lotKey || !importRequest || !normalizedLabel || !origin) {
        fail("historical_ownership_preview_invalid");
      }
      explicit.push({ lotKey, importRequest, normalizedLabel, originClientAccountId: origin });
    }
  }

  if (typeof record.mappingText === "string" && record.mappingText.trim() !== "") {
    explicit.push(...parseMappingText(record.mappingText, defaultClient));
  } else if (record.mappingText != null && record.mappingText !== "") {
    fail("mapping_rejected");
  }

  const scopeProposals: ScopeProposal[] = [];
  let scopeType: "inventory_lot" | "import_request" | null = null;
  let scopeKey: string | null = null;
  if (record.proposals != null || record.scopeType != null || record.scopeKey != null) {
    if (record.scopeType !== "inventory_lot" && record.scopeType !== "import_request") {
      fail("historical_ownership_preview_invalid");
    }
    scopeKey = parseScopeKey(record.scopeKey);
    if (!scopeKey) fail("historical_ownership_preview_invalid");
    scopeType = record.scopeType;
    if (!Array.isArray(record.proposals) || record.proposals.length === 0) {
      fail("historical_ownership_preview_invalid");
    }
    for (const entry of record.proposals) {
      const row = objectRecord(entry, "historical_ownership_preview_invalid");
      rejectUnknown(row, PROPOSAL_KEYS, "historical_ownership_preview_invalid");
      const normalizedLabel = parseLabel(row.normalizedLabel, 300);
      const origin = parseClientId(row.originClientAccountId);
      if (!normalizedLabel || !origin) fail("historical_ownership_preview_invalid");
      scopeProposals.push({ scopeType, scopeKey, normalizedLabel, originClientAccountId: origin });
    }
  }

  if (explicit.length === 0 && scopeProposals.length === 0) fail("historical_ownership_preview_invalid");
  if (explicit.length > HISTORICAL_OWNERSHIP_MAX_IDENTITIES) fail("historical_ownership_preview_too_many");
  if (scopeProposals.length > HISTORICAL_OWNERSHIP_MAX_IDENTITIES) fail("historical_ownership_preview_too_many");

  return {
    explicit,
    scopeProposals,
    scopeMode: scopeProposals.length > 0 && explicit.length === 0 ? "single_scope" : "campaigns",
    scopeType,
    scopeKey,
  };
}

export function identitiesFromExplicit(campaigns: ExplicitCampaign[]): CampaignIdentity[] {
  const grouped = new Map<string, CampaignIdentity>();
  for (const campaign of campaigns) {
    const key = campaignKey(campaign.lotKey, campaign.importRequest, campaign.normalizedLabel);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ordinal: grouped.size,
        lotKey: campaign.lotKey,
        importRequest: campaign.importRequest,
        normalizedLabel: campaign.normalizedLabel,
        originClientAccountIds: [campaign.originClientAccountId],
        ambiguousScope: false,
      });
      continue;
    }
    if (!existing.originClientAccountIds.includes(campaign.originClientAccountId)) {
      existing.originClientAccountIds.push(campaign.originClientAccountId);
    }
  }
  return [...grouped.values()];
}

export function envelopeForIdentities(
  identities: CampaignIdentity[],
  parsed: { scopeMode: "single_scope" | "campaigns"; scopeType: "inventory_lot" | "import_request" | null; scopeKey: string | null }
): Pick<ParsedPreviewRequest, "scopeMode" | "scopeType" | "scopeKey"> {
  if (parsed.scopeMode === "single_scope" && parsed.scopeType && parsed.scopeKey) {
    return { scopeMode: "single_scope", scopeType: parsed.scopeType, scopeKey: parsed.scopeKey };
  }
  const lots = new Set(identities.map((identity) => identity.lotKey).filter((value): value is string => Boolean(value)));
  return {
    scopeMode: "campaigns",
    scopeType: "inventory_lot",
    scopeKey: lots.size === 1 ? [...lots][0] : "multiple",
  };
}
