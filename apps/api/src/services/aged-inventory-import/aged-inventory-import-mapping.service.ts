import { createHash } from "node:crypto";

import {
  AGED_INVENTORY_IMPORT_MAX_FILE_BYTES,
  AGED_INVENTORY_IMPORT_MAX_ROWS,
} from "@sa360/shared";

import type { ImportFieldMapping } from "../bulk-import/bulk-import.types.js";
import { parseCsvText } from "../bulk-import/csv-import-parser.service.js";
import {
  applyFieldMapping,
  suggestFieldMappings,
  splitFullName,
} from "../bulk-import/csv-import-mapping.service.js";
import { AGED_INVENTORY_CANONICAL_FIELDS } from "./aged-inventory-import.types.js";

const AGED_HEADER_HINTS: Record<string, string> = {
  generated_at: "generated_at",
  generated_date: "generated_at",
  lead_date: "generated_at",
  lead_created_at: "generated_at",
  created_date: "generated_at",
  date_generated: "generated_at",
  niche: "niche",
  niche_key: "niche",
  vertical: "niche",
  product_type: "product_type",
  product: "product_type",
  source_provider: "source_provider",
  provider: "source_provider",
  campaign_name: "campaign_name",
  campaign: "campaign_name",
  batch_name: "campaign_name",
};

export function fingerprintAgedInventoryCsv(csvText: string): string {
  return createHash("sha256").update(csvText, "utf8").digest("hex");
}

export function resolveAgedInventoryMaxRows(): number {
  const env = process.env.AGED_INVENTORY_IMPORT_MAX_ROWS?.trim();
  const parsed = env ? Number.parseInt(env, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, AGED_INVENTORY_IMPORT_MAX_ROWS);
  return AGED_INVENTORY_IMPORT_MAX_ROWS;
}

export function validateAgedInventoryUpload(input: {
  fileName: string;
  csvText: string;
}): { ok: true } | { ok: false; code: string } {
  if (!input.fileName.toLowerCase().endsWith(".csv")) {
    return { ok: false, code: "invalid_file_type" };
  }
  const bytes = Buffer.byteLength(input.csvText, "utf8");
  if (bytes > AGED_INVENTORY_IMPORT_MAX_FILE_BYTES) {
    return { ok: false, code: "file_too_large" };
  }
  if (!input.csvText.trim()) {
    return { ok: false, code: "empty_file" };
  }
  return { ok: true };
}

export function parseAgedInventoryCsv(csvText: string) {
  const maxRows = resolveAgedInventoryMaxRows();
  return parseCsvText(csvText, { maxRows, hasHeader: true });
}

export function suggestAgedInventoryMappings(headers: string[]) {
  const base = suggestFieldMappings(headers);
  return base.map((row) => {
    const normalized = row.csvColumn.trim().toLowerCase().replace(/\s+/g, "_");
    const hint = AGED_HEADER_HINTS[normalized];
    if (hint && AGED_INVENTORY_CANONICAL_FIELDS.includes(hint as (typeof AGED_INVENTORY_CANONICAL_FIELDS)[number])) {
      return {
        ...row,
        suggestedCanonical: hint,
        confidence: "high" as const,
        action: "map" as const,
      };
    }
    if (row.suggestedCanonical === "lead_created_at") {
      return { ...row, suggestedCanonical: "generated_at", action: "map" as const };
    }
    return row;
  });
}

export function buildAgedInventoryMappingFromSuggestions(
  suggestions: ReturnType<typeof suggestAgedInventoryMappings>
): ImportFieldMapping {
  const mapping: ImportFieldMapping = {};
  for (const row of suggestions) {
    if (row.action === "map" && row.suggestedCanonical) {
      mapping[row.csvColumn] = row.suggestedCanonical;
    }
  }
  return mapping;
}

export function validateAgedInventoryMapping(mapping: ImportFieldMapping): string[] {
  const errors: string[] = [];
  const required = ["generated_at", "state", "niche"] as const;
  const mappedTargets = new Set(Object.values(mapping));
  for (const field of required) {
    if (!mappedTargets.has(field)) {
      if (field === "niche" && mappedTargets.has("niche_key")) continue;
      errors.push(`missing_required_mapping:${field}`);
    }
  }
  if (!mappedTargets.has("phone") && !mappedTargets.has("email")) {
    errors.push("missing_identity_mapping");
  }
  const byTarget = new Map<string, string[]>();
  for (const [csvColumn, target] of Object.entries(mapping)) {
    if (!target || target === "ignore" || target === "unmapped") continue;
    const list = byTarget.get(target) ?? [];
    list.push(csvColumn);
    byTarget.set(target, list);
  }
  for (const [canonical, csvColumns] of byTarget.entries()) {
    if (csvColumns.length > 1) errors.push(`mapping_conflict:${canonical}`);
  }
  return errors;
}

export type AgedInventoryCanonicalFields = {
  sourceLeadId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  generatedAtRaw: string | null;
  niche: string | null;
  productType: string | null;
  sourceProvider: string | null;
  campaignName: string | null;
};

export function extractAgedInventoryCanonicalFields(
  fields: Record<string, string>,
  mapping: ImportFieldMapping,
  defaults?: { nicheKey?: string; productType?: string }
): AgedInventoryCanonicalFields {
  const mapped = applyFieldMapping(fields, mapping);
  const canonical = mapped.canonical as Record<string, string>;
  let firstName = canonical.first_name ?? null;
  let lastName = canonical.last_name ?? null;
  if ((!firstName || !lastName) && canonical.full_name) {
    const split = splitFullName(canonical.full_name);
    firstName = firstName ?? split.first_name ?? null;
    lastName = lastName ?? split.last_name ?? null;
  }
  return {
    sourceLeadId: canonical.source_lead_id ?? null,
    firstName,
    lastName,
    phone: canonical.phone ?? null,
    email: canonical.email ?? null,
    state: canonical.state ?? null,
    generatedAtRaw: canonical.generated_at ?? canonical.lead_created_at ?? null,
    niche: canonical.niche ?? canonical.niche_key ?? defaults?.nicheKey ?? null,
    productType: canonical.product_type ?? defaults?.productType ?? null,
    sourceProvider: canonical.source_provider ?? null,
    campaignName: canonical.campaign_name ?? null,
  };
}

export function normalizeAgedInventoryNiche(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toLowerCase();
}

export function normalizeAgedInventoryEmail(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toLowerCase();
}

export function maskExternalLeadId(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const id = value.trim();
  if (id.length <= 4) return `${id.slice(0, 1)}***`;
  return `${id.slice(0, 2)}***${id.slice(-2)}`;
}
