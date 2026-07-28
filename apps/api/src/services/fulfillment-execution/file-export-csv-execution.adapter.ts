import type { DeliveryAdapterValidateResult } from "../fulfillment-shadow/delivery-adapter.registry.js";
import {
  BUYER_CSV_COLUMNS,
  BUYER_CSV_FIELD_SCHEMA_VERSION,
  extractBuyerCsvFields,
  serializeBuyerCsv,
  sha256Hex,
} from "../ppl-fulfillment/buyer-csv-export.service.js";
import type { ExecutionAdapterContract } from "./execution-adapter.registry.js";

/**
 * Buyer-safe CSV artifact adapter.
 * Generates allowlisted CSV simulation evidence; does not call Google Sheets.
 */
export const fileExportCsvExecutionAdapter: ExecutionAdapterContract = {
  adapterKey: "file_export.csv.v1",
  validateTarget: (): DeliveryAdapterValidateResult => ({
    ok: true,
    readinessStatus: "ready_for_simulation",
  }),
  buildPayload: (input) => {
    const meta = input.configMetadata ?? {};
    const generatedAtRaw = meta.generatedAt;
    const generatedAt =
      typeof generatedAtRaw === "string" && generatedAtRaw.trim()
        ? new Date(generatedAtRaw)
        : new Date();
    const nicheKey =
      typeof meta.nicheKey === "string" && meta.nicheKey.trim()
        ? meta.nicheKey.trim()
        : "unknown";
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: meta.normalizedPayloadJson ?? {},
      generatedAt: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt,
      nicheKey,
    });
    const csv = serializeBuyerCsv([row]);
    return {
      adapterKey: "file_export.csv.v1",
      allocationId: input.allocationId,
      instructionId: input.instructionId,
      fieldSchemaVersion: BUYER_CSV_FIELD_SCHEMA_VERSION,
      columns: [...BUYER_CSV_COLUMNS],
      contentSha256: sha256Hex(csv),
      rowCount: 1,
      simulation: true,
    };
  },
  async simulate({ payload }) {
    return {
      ok: true,
      simulation: true,
      sanitizedResponse: {
        adapterKey: "file_export.csv.v1",
        fieldSchemaVersion: payload.fieldSchemaVersion ?? BUYER_CSV_FIELD_SCHEMA_VERSION,
        contentSha256: payload.contentSha256 ?? null,
        rowCount: payload.rowCount ?? 1,
        sheetsApiWrite: false,
        simulatedAt: new Date().toISOString(),
      },
      externalReference:
        typeof payload.instructionId === "string"
          ? `file_export:${payload.instructionId}`
          : null,
    };
  },
};
