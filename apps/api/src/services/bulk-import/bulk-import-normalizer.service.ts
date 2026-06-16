import { createHash } from "node:crypto";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { splitFullName } from "./csv-import-mapping.service.js";
import type {
  BulkImportOptions,
  ImportDefaultValues,
  ImportFieldMapping,
  ParsedImportRow,
} from "./bulk-import.types.js";
import { buildImportRouteKey } from "./bulk-import.types.js";

const MANUAL_IMPORT_MASTER_CLIENT = "manual_import";

export type NormalizeBulkImportRowInput = {
  batchId: string;
  row: ParsedImportRow;
  canonical: Record<string, string>;
  unmapped: Array<{ key: string; value: string }>;
  importLabel?: string;
  options?: BulkImportOptions;
  defaults?: ImportDefaultValues;
};

export type ResolvedBulkImportLeadId = {
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
};

export function resolveBulkImportLeadId(
  canonical: Record<string, string>,
  batchId: string,
  vendorLabel?: string
): ResolvedBulkImportLeadId {
  const explicit =
    canonical.source_lead_id?.trim() ||
    canonical.lead_id?.trim() ||
    canonical.vendor_lead_id?.trim();
  if (explicit) {
    return { sourceLeadId: explicit, sourceLeadIdGenerated: false };
  }

  const phone = canonical.phone?.replace(/\D/g, "") ?? "";
  const email = canonical.email?.trim().toLowerCase() ?? "";
  const basis = [batchId, vendorLabel ?? "", phone, email].join(":");
  const hash = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  return { sourceLeadId: `gen-${hash}`, sourceLeadIdGenerated: true };
}

export function normalizeBulkImportRowToLifecycle(
  input: NormalizeBulkImportRowInput
): LifecycleEventSchema {
  const routeKey = buildImportRouteKey(input.batchId);
  const { sourceLeadId, sourceLeadIdGenerated } = resolveBulkImportLeadId(
    input.canonical,
    input.batchId,
    input.options?.vendorLabel
  );

  let firstName: string | undefined = input.canonical.first_name;
  let lastName: string | undefined = input.canonical.last_name;
  if (!firstName && !lastName && input.canonical.full_name) {
    const split = splitFullName(input.canonical.full_name);
    firstName = split.first_name;
    lastName = split.last_name;
  }

  const phoneRaw = input.canonical.phone ?? "";
  const phoneResult = phoneRaw ? tryNormalizeToVerifiedE164(phoneRaw) : null;
  const phoneE164 = phoneResult?.ok ? phoneResult.e164 : undefined;
  const submittedAt = input.canonical.lead_created_at ?? new Date().toISOString();
  const campaignLabel = input.options?.campaignLabel ?? input.importLabel ?? routeKey;
  const leadUid = `manualimport-csv_import-${sourceLeadId}`;

  const sourceAttributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.canonical)) {
    if (
      [
        "first_name",
        "last_name",
        "full_name",
        "phone",
        "email",
        "state",
        "source_lead_id",
        "lead_id",
      ].includes(key)
    ) {
      continue;
    }
    if (value.trim()) sourceAttributes[key] = value.trim();
  }

  return {
    schema_version: "MASTER 2.0",
    client_account_id: input.options?.useExistingRoutingRules
      ? MANUAL_IMPORT_MASTER_CLIENT
      : (input.options as { destinationClientAccountId?: string } | undefined)?.destinationClientAccountId ??
        MANUAL_IMPORT_MASTER_CLIENT,
    subaccount_id_ghl:
      (input.options as { destinationLocationIdGhl?: string } | undefined)?.destinationLocationIdGhl ??
      MANUAL_IMPORT_MASTER_CLIENT,
    contact: {
      lead_uid: leadUid,
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      email: input.canonical.email,
      phone: phoneRaw || undefined,
      phone_e164: phoneE164,
      state: input.canonical.state,
    },
    attribution: {
      source_platform: "manual_import",
      source_type: "bulk_import",
      utm_source: input.canonical.utm_source ?? input.options?.vendorLabel ?? "csv_import",
      utm_medium: input.canonical.utm_medium ?? "bulk_import",
      utm_campaign: input.canonical.utm_campaign ?? campaignLabel,
      campaign_id: input.canonical.campaign_id ?? routeKey,
      campaign_name: input.canonical.campaign_name ?? campaignLabel,
      ad_id: input.canonical.ad_id,
      ad_name: input.canonical.ad_name,
      adset_id: input.canonical.adset_id,
      adset_name: input.canonical.adset_name,
      fbclid: input.canonical.fbclid,
    },
    state: {
      lifecycle_stage: "NEW",
      routing_status: "RECEIVED",
      lead_type: input.options?.nicheKey ?? "VET",
    },
    event: {
      event_uuid: `BULK-${input.batchId}-lead_created-${sourceLeadId}-${input.row.rowNumber}`,
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      send_to_meta: false,
    },
    routing: {
      niche_key: input.options?.nicheKey ?? "VET",
      niche_label: input.options?.nicheLabel ?? "Veteran",
      product_type: input.options?.productType ?? "Final Expense",
      campaign_key: routeKey,
      lead_pool_id: `bulk-import-${input.batchId}`,
      source_intake: {
        provider: "manual_import",
        source_system: "csv_import",
        source_type: "bulk_import",
        source_route_key: routeKey,
        campaign_name: campaignLabel,
        lead_id: sourceLeadId,
        source_lead_id_generated: sourceLeadIdGenerated,
        submitted_at: submittedAt,
        sourceImportBatchId: input.batchId,
        sourceImportRowNumber: input.row.rowNumber,
        import_label: input.importLabel,
        vendor_label: input.options?.vendorLabel,
        sourceAttributes,
        unmappedSourceFieldsJson: input.unmapped,
      },
    },
  };
}
