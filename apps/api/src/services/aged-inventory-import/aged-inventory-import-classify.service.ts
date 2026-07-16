import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue, maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { prisma as defaultPrisma } from "../../lib/db.js";
import { findCorrelatedSourceLeadEvents } from "../../repositories/source-lead-event.repository.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { buildWithinBatchDuplicateIndex } from "../bulk-import/bulk-import-duplicate.service.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { normalizeInventoryState } from "../lead-inventory/lead-inventory-state.js";
import {
  isFutureGeneratedAt,
  parseGeneratedAt,
} from "./aged-inventory-import-date.service.js";
import {
  extractAgedInventoryCanonicalFields,
  maskExternalLeadId,
  normalizeAgedInventoryEmail,
  normalizeAgedInventoryNiche,
} from "./aged-inventory-import-mapping.service.js";
import type {
  AgedInventoryDateFormat,
  AgedInventoryNormalizedRow,
  AgedInventoryParsedRowInput,
  AgedInventoryRowClassification,
} from "./aged-inventory-import.types.js";
import type { ImportFieldMapping } from "../bulk-import/bulk-import.types.js";

const AGED_SOURCE_PROVIDER = "manual_import" as const;
const AGED_SOURCE_SYSTEM = "csv_import" as const;

function resolveSourceLeadId(raw: string | null, rowNumber: number): string {
  if (raw?.trim()) return raw.trim();
  return `gen-aged-${rowNumber}`;
}

export async function normalizeAndClassifyAgedInventoryRows(
  input: {
    rows: AgedInventoryParsedRowInput[];
    mapping: ImportFieldMapping;
    mappingErrors: string[];
    dateFormat?: AgedInventoryDateFormat;
    defaultNicheKey?: string;
    defaultProductType?: string;
    evaluatedAt?: Date;
  },
  db: PrismaClient = defaultPrisma
): Promise<AgedInventoryNormalizedRow[]> {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);

  if (input.mappingErrors.length > 0) {
    return input.rows.map((row) => ({
      rowNumber: row.rowNumber,
      sourceLeadId: resolveSourceLeadId(null, row.rowNumber),
      maskedSourceLeadId: maskExternalLeadId(resolveSourceLeadId(null, row.rowNumber))!,
      firstName: null,
      lastName: null,
      phoneE164: null,
      email: null,
      state: null,
      generatedAt: null,
      generatedAtSource: null,
      nicheKey: null,
      productType: null,
      sourceProviderLabel: null,
      campaignName: null,
      ageDays: null,
      ageBandKey: null,
      classification: "mapping_error",
      blockerCodes: input.mappingErrors,
      correctionHint: "Fix column mapping before import.",
      phoneFingerprint: null,
      emailFingerprint: null,
    }));
  }

  const identityIndex = buildWithinBatchDuplicateIndex(
    input.rows.map((row) => {
      const fields = extractAgedInventoryCanonicalFields(row.fields, input.mapping, {
        nicheKey: input.defaultNicheKey,
        productType: input.defaultProductType,
      });
      const phoneNorm = fields.phone ? tryNormalizeToVerifiedE164(fields.phone) : null;
      const phone =
        phoneNorm && "e164" in phoneNorm ? phoneNorm.e164 : undefined;
      return {
        rowNumber: row.rowNumber,
        phone,
        email: normalizeAgedInventoryEmail(fields.email) ?? undefined,
        sourceLeadId: fields.sourceLeadId ?? undefined,
      };
    })
  );

  const results: AgedInventoryNormalizedRow[] = [];

  for (const row of input.rows) {
    const fields = extractAgedInventoryCanonicalFields(row.fields, input.mapping, {
      nicheKey: input.defaultNicheKey,
      productType: input.defaultProductType,
    });
    const sourceLeadId = resolveSourceLeadId(fields.sourceLeadId, row.rowNumber);
    const blockerCodes: string[] = [];
    let classification: AgedInventoryRowClassification = "ready";
    let correctionHint: string | null = null;

    const phoneResult = fields.phone ? tryNormalizeToVerifiedE164(fields.phone) : null;
    const phoneE164 = phoneResult && "e164" in phoneResult ? phoneResult.e164 : null;
    const email = normalizeAgedInventoryEmail(fields.email);
    if (!phoneE164 && !email) {
      classification = "invalid_identity";
      blockerCodes.push("invalid_identity");
      correctionHint = "Provide a valid phone or email.";
    } else if (fields.phone && !phoneE164) {
      classification = "invalid_identity";
      blockerCodes.push("invalid_phone");
      correctionHint = "Phone could not be normalized to E.164.";
    }

    const state = normalizeInventoryState(fields.state);
    if (!state || state.length !== 2) {
      classification = classification === "ready" ? "invalid_state" : classification;
      blockerCodes.push("invalid_state");
      correctionHint = correctionHint ?? "State must be a valid US abbreviation.";
    }

    const generated = parseGeneratedAt(fields.generatedAtRaw, input.dateFormat);
    let generatedAt: Date | null = null;
    if (!generated.ok) {
      const code = generated.code;
      classification =
        code === "generated_at_missing"
          ? "generated_at_missing"
          : code === "generated_at_ambiguous"
            ? "generated_at_ambiguous"
            : "generated_at_invalid";
      blockerCodes.push(code);
      correctionHint =
        correctionHint ??
        (code === "generated_at_ambiguous"
          ? "Confirm date format (e.g. mdy_slash) during preview."
          : "Generated date is required and must parse deterministically.");
    } else {
      generatedAt = generated.value;
      if (isFutureGeneratedAt(generatedAt, evaluatedAt)) {
        classification = "future_generated_at";
        blockerCodes.push("future_generated_at");
        correctionHint = correctionHint ?? "Generated date cannot be in the future.";
      }
    }

    const nicheKey = normalizeAgedInventoryNiche(fields.niche);
    if (!nicheKey) {
      classification = classification === "ready" ? "niche_missing" : classification;
      blockerCodes.push("niche_missing");
      correctionHint = correctionHint ?? "Niche is required.";
    }

    const phoneFingerprint = phoneE164 ? fingerprintIdentityValue("phone", phoneE164) : null;
    const emailFingerprint = email ? fingerprintIdentityValue("email", email) : null;

    if (classification === "ready") {
      const dupIndex = identityIndex;
      const phoneDup = phoneE164 ? (dupIndex.byPhone.get(phoneE164) ?? []).filter((n) => n !== row.rowNumber) : [];
      const emailDup = email ? (dupIndex.byEmail.get(email) ?? []).filter((n) => n !== row.rowNumber) : [];
      const idDup =
        fields.sourceLeadId && !sourceLeadId.startsWith("gen-")
          ? (dupIndex.bySourceLeadId.get(sourceLeadId) ?? []).filter((n) => n !== row.rowNumber)
          : [];
      if (phoneDup.length || emailDup.length || idDup.length) {
        classification = "duplicate_in_file";
        blockerCodes.push("duplicate_in_file");
        correctionHint = "Duplicate identity or external ID within this file.";
      }
    }

    if (classification === "ready" && !sourceLeadId.startsWith("gen-")) {
      const existingEvents = await findCorrelatedSourceLeadEvents(
        AGED_SOURCE_PROVIDER,
        AGED_SOURCE_SYSTEM,
        sourceLeadId,
        undefined,
        db
      );
      if (existingEvents.length > 0) {
        const inventoryLinked = await db.leadInventoryItem.findFirst({
          where: { sourceLeadEventId: existingEvents[0]!.id },
          select: { id: true },
        });
        if (inventoryLinked) {
          classification = "already_inventory";
          blockerCodes.push("already_inventory");
          correctionHint = "Lead already exists in inventory.";
        } else {
          classification = "existing_source_event";
          blockerCodes.push("existing_source_event");
          correctionHint = "Source lead event already exists; review before import.";
        }
      }
    }

    if (classification === "ready" && (phoneE164 || email)) {
      const correlated = await db.sourceLeadEvent.findMany({
        where: {
          OR: [
            ...(phoneE164
              ? [
                  {
                    normalizedPayloadJson: {
                      path: ["phone_e164"],
                      equals: phoneE164,
                    },
                  },
                ]
              : []),
            ...(email
              ? [
                  {
                    normalizedPayloadJson: {
                      path: ["email"],
                      equals: email,
                    },
                  },
                ]
              : []),
          ],
        },
        select: { id: true, leadInventoryItem: { select: { id: true } } },
        take: 3,
      });
      for (const hit of correlated) {
        if (hit.leadInventoryItem) {
          classification = "already_inventory";
          blockerCodes.push("already_inventory");
          correctionHint = "Matching lead already linked to inventory.";
          break;
        }
        if (classification === "ready") {
          classification = "existing_source_event";
          blockerCodes.push("existing_source_event");
          correctionHint = "Matching source lead event already exists.";
        }
      }
    }

    const ageDays =
      generatedAt != null ? calculateInventoryAgeDays(generatedAt, evaluatedAt) : null;
    const ageBandKey =
      ageDays != null ? resolveAgeBandKey(ageDays, ageBands) : null;

    results.push({
      rowNumber: row.rowNumber,
      sourceLeadId,
      maskedSourceLeadId: maskExternalLeadId(sourceLeadId)!,
      firstName: fields.firstName,
      lastName: fields.lastName,
      phoneE164,
      email,
      state,
      generatedAt,
      generatedAtSource: generated.ok ? generated.format : null,
      nicheKey,
      productType: fields.productType?.trim() || input.defaultProductType || null,
      sourceProviderLabel: fields.sourceProvider,
      campaignName: fields.campaignName,
      ageDays,
      ageBandKey,
      classification,
      blockerCodes,
      correctionHint,
      phoneFingerprint,
      emailFingerprint,
    });
  }

  return results;
}

export function buildAgedInventoryLeadUid(sourceLeadId: string): string {
  return `manualimport-aged_inventory_csv-${sourceLeadId}`;
}

export function maskLeadUidForPreview(leadUid: string): string {
  return maskSourceLeadUidForAudit(leadUid) ?? "****";
}
