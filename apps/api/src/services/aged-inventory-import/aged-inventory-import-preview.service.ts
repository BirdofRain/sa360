import {
  AGED_INVENTORY_IMPORT_SOURCE_LANE,
} from "@sa360/shared";

import type {
  AgedInventoryNormalizedRow,
  AgedInventoryPreviewInput,
  AgedInventorySummaryCounts,
} from "./aged-inventory-import.types.js";
import {
  buildAgedInventoryMappingFromSuggestions,
  fingerprintAgedInventoryCsv,
  parseAgedInventoryCsv,
  suggestAgedInventoryMappings,
  validateAgedInventoryMapping,
  validateAgedInventoryUpload,
} from "./aged-inventory-import-mapping.service.js";
import { normalizeAndClassifyAgedInventoryRows } from "./aged-inventory-import-classify.service.js";

function summarizeRows(rows: AgedInventoryNormalizedRow[]): AgedInventorySummaryCounts {
  const byState: Record<string, number> = {};
  const byAgeBand: Record<string, number> = {};
  const byClassification: Record<string, number> = {};
  const byBlocker: Record<string, number> = {};

  let valid = 0;
  let duplicate = 0;
  let alreadyExisting = 0;
  let ready = 0;
  let quarantined = 0;

  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] ?? 0) + 1;
    for (const code of row.blockerCodes) {
      byBlocker[code] = (byBlocker[code] ?? 0) + 1;
    }
    if (row.classification === "ready") {
      valid += 1;
      ready += 1;
      if (row.state) byState[row.state] = (byState[row.state] ?? 0) + 1;
      if (row.ageBandKey) byAgeBand[row.ageBandKey] = (byAgeBand[row.ageBandKey] ?? 0) + 1;
    } else if (
      row.classification === "duplicate_in_file" ||
      row.classification === "existing_source_event"
    ) {
      duplicate += 1;
    } else if (row.classification === "already_inventory") {
      alreadyExisting += 1;
      duplicate += 1;
    } else {
      quarantined += 1;
    }
  }

  const invalid = rows.length - ready;
  return {
    total: rows.length,
    valid,
    invalid,
    duplicate,
    alreadyExisting,
    ready,
    quarantined,
    byState,
    byAgeBand,
    byClassification,
    byBlocker,
  };
}

export async function buildAgedInventoryImportPreview(input: AgedInventoryPreviewInput) {
  const upload = validateAgedInventoryUpload(input);
  if (!upload.ok) {
    return { ok: false as const, error: upload.code, writesPerformed: 0 };
  }

  let parsed;
  try {
    parsed = parseAgedInventoryCsv(input.csvText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse_failed";
    return { ok: false as const, error: message, writesPerformed: 0 };
  }

  if (parsed.headers.length === 0) {
    return { ok: false as const, error: "missing_headers", writesPerformed: 0 };
  }

  const suggestions = suggestAgedInventoryMappings(parsed.headers);
  const mapping = input.mapping ?? buildAgedInventoryMappingFromSuggestions(suggestions);
  const mappingErrors = validateAgedInventoryMapping(mapping);
  const rows = await normalizeAndClassifyAgedInventoryRows({
    rows: parsed.rows,
    mapping,
    mappingErrors,
    dateFormat: input.dateFormat,
    defaultNicheKey: input.defaultNicheKey,
    defaultProductType: input.defaultProductType,
    evaluatedAt: input.evaluatedAt,
  });

  const summary = summarizeRows(rows);
  const commitAllowed =
    mappingErrors.length === 0 && summary.ready > 0 && summary.ready <= summary.total;

  return {
    ok: true as const,
    writesPerformed: 0,
    fileFingerprint: fingerprintAgedInventoryCsv(input.csvText),
    fileName: input.fileName,
    detectedHeaders: parsed.headers,
    proposedMapping: mapping,
    mappingSuggestions: suggestions,
    mappingErrors,
    dateFormat: input.dateFormat ?? null,
    summary,
    rowPreviews: rows.map((row) => ({
      rowNumber: row.rowNumber,
      maskedExternalLeadId: row.maskedSourceLeadId,
      classification: row.classification,
      blockerCodes: row.blockerCodes,
      correctionHint: row.correctionHint,
      state: row.state,
      ageBandKey: row.ageBandKey,
      ageDays: row.ageDays,
      nicheKey: row.nicheKey,
    })),
    commitAllowed,
    expectedLot: {
      inventoryClass: "aged" as const,
      sourceProvider: "manual_import" as const,
      sourceLane: AGED_INVENTORY_IMPORT_SOURCE_LANE,
      nicheKey: input.defaultNicheKey ?? null,
      productType: input.defaultProductType ?? null,
    },
    evaluatedAt: (input.evaluatedAt ?? new Date()).toISOString(),
  };
}
