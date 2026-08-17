import type {
  InventoryLot,
  LeadProof,
  LeadVerificationResult,
  Prisma,
  PrismaClient,
  SourceLeadEvent,
} from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import {
  buildLeadDetailsFromCanonicalMap,
  readOptionalBuyerSalesContextFields,
  type OptionalBuyerSalesContextField,
} from "../ppl-fulfillment/buyer-lead-fields.js";
import {
  resolveInventoryCommerceLifecycle,
  isPurchasableInventoryCommerceLifecycle,
  type InventoryCommerceLifecycleKey,
} from "../ppl-fulfillment/commerce-lifecycle.js";
import { DEFAULT_AGE_BANDS_V1 } from "./lead-inventory.constants.js";
import { calculateInventoryAgeDays } from "./lead-inventory-age.js";
import { resolveInventoryGeneratedAt } from "./lead-inventory-generated-at.js";
import { normalizeInventoryState } from "./lead-inventory-state.js";
import { assessCampaignInventoryIntakeActivation } from "../lead-inventory-review/lead-inventory-review-eligibility.service.js";
import {
  buildCampaignIdentityFingerprints,
  findExistingCampaignInventoryIdentity,
  type CampaignIdentityLookupDiagnostics,
  type CampaignInventoryIdentityHit,
} from "./campaign-inventory-identity.js";

export const CAMPAIGN_INVENTORY_SOURCE_LANES = ["meta_lead_ads", "leadcapture_io"] as const;
export type CampaignInventorySourceLane = (typeof CAMPAIGN_INVENTORY_SOURCE_LANES)[number];

export const CAMPAIGN_PROVENANCE_KIND = "campaign" as const;

const ADDITIONAL_EVENT_IDS_CAP = 20;

export type CampaignInventoryTrackingResult =
  | {
      ok: true;
      outcome:
        | "created"
        | "reused_same_event"
        | "reused_source_lead_id"
        | "reused_phone"
        | "reused_email"
        | "reused_historical"
        | "generated_at_missing";
      inventoryItemId: string | null;
      sourceLeadEventId: string;
      sourceLane: CampaignInventorySourceLane;
      generatedAt: string | null;
      generatedAtSource: string | null;
      commerceEligible: boolean;
      inventoryStatus: "available" | "pending_review" | null;
      lifecycleKey: InventoryCommerceLifecycleKey;
      identityMatch: CampaignInventoryIdentityHit["match"] | null;
      diagnostics: CampaignIdentityLookupDiagnostics;
    }
  | {
      ok: false;
      code: "source_event_not_found" | "not_normalized" | "inventory_tracking_failed";
      sourceLeadEventId: string;
      reasons: string[];
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCampaignSourceLane(value: string): value is CampaignInventorySourceLane {
  return (CAMPAIGN_INVENTORY_SOURCE_LANES as readonly string[]).includes(value);
}

export function resolveCampaignNicheKey(event: Pick<SourceLeadEvent, "normalizedPayloadJson">): string {
  const payload = asRecord(event.normalizedPayloadJson);
  const routing = payload ? asRecord(payload.routing) : null;
  const state = payload ? asRecord(payload.state) : null;
  const contact = payload ? asRecord(payload.contact) : null;
  const raw =
    readString(routing?.niche_key) ??
    readString(state?.lead_type) ??
    readString(payload?.niche_key) ??
    readString(payload?.niche) ??
    readString(contact?.niche);
  return raw ? raw.toLowerCase() : "unspecified";
}

function resolveCampaignKey(event: SourceLeadEvent): string {
  return (
    readString(event.sourceCampaignId) ??
    readString(event.sourceRouteKey) ??
    "unattributed"
  );
}

function readAttribution(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  return payload ? asRecord(payload.attribution) : null;
}

function readSourceIntake(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const routing = payload ? asRecord(payload.routing) : null;
  return routing ? asRecord(routing.source_intake) : null;
}

function buildCampaignProvenanceMetadata(input: {
  event: SourceLeadEvent;
  sourceLane: CampaignInventorySourceLane;
  generatedAtSource: string | null;
  generatedAtMissing: boolean;
  additionalSourceLeadEventIds?: string[];
}): Prisma.JsonObject {
  const payload = asRecord(input.event.normalizedPayloadJson);
  const attribution = readAttribution(payload);
  const sourceIntake = readSourceIntake(payload);
  return {
    provenanceKind: CAMPAIGN_PROVENANCE_KIND,
    sourceLane: input.sourceLane,
    sourceLeadEventId: input.event.id,
    sourceLeadId: input.event.sourceLeadId,
    sourceLeadUid: input.event.sourceLeadUid,
    sourceProvider: input.event.sourceProvider,
    sourceSystem: input.event.sourceSystem,
    campaignId:
      input.event.sourceCampaignId ??
      readString(attribution?.campaign_id) ??
      readString(sourceIntake?.campaign_id),
    campaignName:
      input.event.sourceCampaignName ??
      readString(attribution?.campaign_name) ??
      readString(sourceIntake?.campaign_name),
    adsetId: readString(attribution?.adset_id) ?? readString(sourceIntake?.adset_id),
    adId: readString(attribution?.ad_id) ?? readString(sourceIntake?.ad_id),
    formId:
      readString(sourceIntake?.form_id) ??
      readString((asRecord(payload?.routing) ?? {}).form_id) ??
      input.event.sourceFunnelName,
    utmSource: readString(attribution?.utm_source),
    utmCampaign: readString(attribution?.utm_campaign),
    generatedAtSource: input.generatedAtSource,
    generatedAtMissing: input.generatedAtMissing,
    additionalSourceLeadEventIds: input.additionalSourceLeadEventIds ?? [],
  };
}

function mergeOptionalSalesContext(
  existingPayload: unknown,
  incomingPayload: unknown,
  nicheKey: string
): Record<string, unknown> {
  const existing = readOptionalBuyerSalesContextFields(existingPayload);
  const incoming = readOptionalBuyerSalesContextFields(incomingPayload);
  const merged: Record<string, string> = {};
  for (const field of Object.keys(existing) as OptionalBuyerSalesContextField[]) {
    merged[field] = existing[field] || incoming[field];
  }
  return buildLeadDetailsFromCanonicalMap(merged, nicheKey);
}

function mergeContactPreferExisting(
  existingPayload: unknown,
  incomingPayload: unknown
): Record<string, unknown> {
  const existing = asRecord(existingPayload);
  const incoming = asRecord(incomingPayload);
  const existingContact = existing ? asRecord(existing.contact) ?? existing : null;
  const incomingContact = incoming ? asRecord(incoming.contact) ?? incoming : null;
  const pick = (key: string): string | undefined => {
    const current = readString(existingContact?.[key]);
    if (current) return current;
    return readString(incomingContact?.[key]) ?? undefined;
  };
  return {
    first_name: pick("first_name") ?? pick("firstName"),
    last_name: pick("last_name") ?? pick("lastName"),
    phone: pick("phone"),
    phone_e164: pick("phone_e164") ?? pick("phoneE164"),
    email: pick("email"),
    state: pick("state"),
  };
}

function appendAdditionalEventId(metadataJson: unknown, eventId: string): string[] {
  const meta = asRecord(metadataJson);
  const existing = Array.isArray(meta?.additionalSourceLeadEventIds)
    ? meta.additionalSourceLeadEventIds.filter((id): id is string => typeof id === "string")
    : [];
  if (existing.includes(eventId)) return existing.slice(-ADDITIONAL_EVENT_IDS_CAP);
  return [...existing, eventId].slice(-ADDITIONAL_EVENT_IDS_CAP);
}

function isRetryableInventoryConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  if (code === "P2002" || code === "P2034") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /unique constraint|could not serialize|40P01|40001/i.test(message);
}

function assessCampaignCreateStatus(input: {
  itemId: string;
  event: SourceLeadEvent;
  sourceLane: CampaignInventorySourceLane;
  generatedAt: Date;
  normalizedState: string;
  nicheKey: string;
  productType: string | null;
  lot: Pick<InventoryLot, "id"> &
    Partial<Pick<InventoryLot, "status" | "lotKey" | "sourceLane" | "sourceProvider">>;
  metadataJson: Prisma.JsonObject;
  leadProof: Pick<LeadProof, "proofStatus"> | null;
  verification: Pick<LeadVerificationResult, "verificationStatus" | "duplicateStatus"> | null;
}): { status: "available" | "pending_review"; availableAt: Date | null; blockerCodes: string[] } {
  const activation = assessCampaignInventoryIntakeActivation({
    item: {
      id: input.itemId,
      status: "pending_review",
      generatedAt: input.generatedAt,
      normalizedState: input.normalizedState || "UN",
      nicheKey: input.nicheKey,
      productType: input.productType,
      sourceProvider: input.event.sourceProvider,
      sourceLane: input.sourceLane,
      inventoryClass: "aged",
      inventoryLotId: input.lot.id,
      sourceLeadEventId: input.event.id,
      quarantineReason: null,
      availableAt: null,
      reservedAt: null,
      committedAt: null,
      withdrawnAt: null,
      expiredAt: null,
      rejectedAt: null,
      maxFulfillments: 1,
      fulfillmentCount: 0,
      metadataJson: input.metadataJson,
    },
    lot: {
      id: input.lot.id,
      status: input.lot.status ?? "active",
      lotKey: input.lot.lotKey ?? input.lot.id,
      sourceLane: input.lot.sourceLane ?? input.sourceLane,
      sourceProvider: input.lot.sourceProvider ?? input.event.sourceProvider,
    },
    sourceLeadEvent: input.event,
    leadProof: input.leadProof,
    verification: input.verification,
    allocations: [],
    ageBands: DEFAULT_AGE_BANDS_V1,
  });
  return {
    status: activation.status,
    availableAt: activation.activate ? new Date() : null,
    blockerCodes: activation.blockerCodes,
  };
}

function outcomeFromMatch(
  match: CampaignInventoryIdentityHit["match"]
): Extract<CampaignInventoryTrackingResult, { ok: true }>["outcome"] {
  if (match === "same_event") return "reused_same_event";
  if (match === "source_lead_id") return "reused_source_lead_id";
  if (match === "phone_fingerprint") return "reused_phone";
  if (match === "email_fingerprint") return "reused_email";
  return "reused_historical";
}

async function ensureCampaignInventoryLot(
  input: {
    sourceLane: CampaignInventorySourceLane;
    sourceProvider: SourceLeadEvent["sourceProvider"];
    campaignKey: string;
    campaignName: string | null;
    formId: string | null;
    nicheKey: string;
    productType: string | null;
  },
  db: Prisma.TransactionClient
) {
  const lotKey = `campaign:${input.sourceLane}:${input.campaignKey}:${input.nicheKey}`;
  const existing = await db.inventoryLot.findUnique({ where: { lotKey } });
  if (existing) return existing;
  try {
    return await db.inventoryLot.create({
      data: {
        lotKey,
        displayName: input.campaignName?.trim() || `Campaign ${input.sourceLane} ${input.campaignKey}`,
        sourceProvider: input.sourceProvider,
        sourceLane: input.sourceLane,
        campaignId: input.campaignKey,
        campaignName: input.campaignName,
        formId: input.formId,
        nicheKey: input.nicheKey,
        productType: input.productType,
        inventoryClass: "aged",
        exclusivityMode: "configurable",
        status: "active",
        activatedAt: new Date(),
        metadataJson: { provenanceKind: CAMPAIGN_PROVENANCE_KIND },
      },
    });
  } catch (err) {
    const raced = await db.inventoryLot.findUnique({ where: { lotKey } });
    if (raced) return raced;
    throw err;
  }
}

async function recordTrackingOnEvent(
  eventId: string,
  tracking: Record<string, unknown>,
  sourceLane: CampaignInventorySourceLane,
  db: PrismaClient | Prisma.TransactionClient
) {
  const event = await db.sourceLeadEvent.findUnique({
    where: { id: eventId },
    select: { enrichmentMetadataJson: true },
  });
  const existing = asRecord(event?.enrichmentMetadataJson) ?? {};
  await db.sourceLeadEvent.update({
    where: { id: eventId },
    data: {
      enrichmentMetadataJson: {
        ...existing,
        sourceLane,
        inventoryTracking: tracking,
      } as Prisma.JsonObject,
    },
  });
}

/**
 * Commit inventory tracking for a successfully normalized campaign source event.
 * Idempotent. Source event is never deleted on tracking failure.
 */
export async function trackCampaignInventoryFromSourceEvent(
  input: {
    sourceLeadEventId: string;
    sourceLane: CampaignInventorySourceLane;
  },
  db: PrismaClient = defaultPrisma
): Promise<CampaignInventoryTrackingResult> {
  if (!isCampaignSourceLane(input.sourceLane)) {
    return {
      ok: false,
      code: "inventory_tracking_failed",
      sourceLeadEventId: input.sourceLeadEventId,
      reasons: ["source_lane_unrecognized"],
    };
  }

  try {
    let attempt = 0;
    while (true) {
      try {
    return await db.$transaction(async (tx) => {
      const event = await tx.sourceLeadEvent.findUnique({
        where: { id: input.sourceLeadEventId },
      });
      if (!event) {
        return {
          ok: false as const,
          code: "source_event_not_found" as const,
          sourceLeadEventId: input.sourceLeadEventId,
          reasons: ["source_event_not_found"],
        };
      }
      if (!event.normalizedPayloadJson) {
        return {
          ok: false as const,
          code: "not_normalized" as const,
          sourceLeadEventId: event.id,
          reasons: ["normalized_payload_missing"],
        };
      }

      const generated = resolveInventoryGeneratedAt(event);
      const fingerprints = buildCampaignIdentityFingerprints(event.normalizedPayloadJson);
      const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
      const normalizedState = normalizeInventoryState(identity?.state ?? null) ?? "";
      const nicheKey = resolveCampaignNicheKey(event);
      const payload = asRecord(event.normalizedPayloadJson);
      const routing = payload ? asRecord(payload.routing) : null;
      const productType = readString(routing?.product_type);

      const lockSeeds = [
        fingerprints.phoneFingerprint,
        fingerprints.emailFingerprint,
        event.sourceLeadId
          ? `${event.sourceProvider}:${event.sourceSystem}:${event.sourceLeadId}`
          : null,
      ].filter((seed): seed is string => Boolean(seed));
      for (const seed of lockSeeds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inv-id:${seed}`}))`;
      }

      const { hit, diagnostics } = await findExistingCampaignInventoryIdentity(
        {
          sourceLeadEventId: event.id,
          sourceProvider: event.sourceProvider,
          sourceSystem: event.sourceSystem,
          sourceLeadId: event.sourceLeadId,
          fingerprints,
        },
        tx
      );

      const evaluatedAt = new Date();
      const ageDays =
        generated.generatedAt != null
          ? calculateInventoryAgeDays(generated.generatedAt, evaluatedAt)
          : null;
      const lifecycleKey = resolveInventoryCommerceLifecycle(ageDays);
      const commerceEligible =
        generated.generatedAt != null && isPurchasableInventoryCommerceLifecycle(lifecycleKey);

      if (!generated.generatedAt && !hit) {
        await recordTrackingOnEvent(
          event.id,
          {
            outcome: "generated_at_missing",
            commerceEligible: false,
            lifecycleKey,
            generatedAtSource: generated.source,
          },
          input.sourceLane,
          tx
        );
        return {
          ok: true as const,
          outcome: "generated_at_missing" as const,
          inventoryItemId: null,
          sourceLeadEventId: event.id,
          sourceLane: input.sourceLane,
          generatedAt: null,
          generatedAtSource: generated.source,
          commerceEligible: false,
          inventoryStatus: null,
          lifecycleKey,
          identityMatch: null,
          diagnostics,
        };
      }

      if (hit) {
        const existing = await tx.leadInventoryItem.findUnique({
          where: { id: hit.inventoryItemId },
          include: { sourceLeadEvent: true },
        });
        if (!existing) {
          throw new Error("identity_hit_missing_item");
        }

        const additionalIds = appendAdditionalEventId(existing.metadataJson, event.id);
        const existingMeta = asRecord(existing.metadataJson) ?? {};
        const mergedDetails = mergeOptionalSalesContext(
          existing.sourceLeadEvent.normalizedPayloadJson,
          event.normalizedPayloadJson,
          existing.nicheKey || nicheKey
        );
        const mergedContact = mergeContactPreferExisting(
          existing.sourceLeadEvent.normalizedPayloadJson,
          event.normalizedPayloadJson
        );
        const existingPayload = asRecord(existing.sourceLeadEvent.normalizedPayloadJson) ?? {};
        const existingContact = asRecord(existingPayload.contact) ?? {};

        await tx.sourceLeadEvent.update({
          where: { id: existing.sourceLeadEventId },
          data: {
            normalizedPayloadJson: {
              ...existingPayload,
              contact: { ...existingContact, ...mergedContact },
              lead_details: mergedDetails,
            } as Prisma.JsonObject,
          },
        });

        const incomingDetails = mergeOptionalSalesContext(
          event.normalizedPayloadJson,
          event.normalizedPayloadJson,
          nicheKey
        );
        const incomingPayload = asRecord(event.normalizedPayloadJson) ?? {};
        await tx.sourceLeadEvent.update({
          where: { id: event.id },
          data: {
            normalizedPayloadJson: {
              ...incomingPayload,
              lead_details: incomingDetails,
            } as Prisma.JsonObject,
          },
        });

        const existingIsCampaign =
          existingMeta.provenanceKind === CAMPAIGN_PROVENANCE_KIND ||
          isCampaignSourceLane(existing.sourceLane);
        const nextState = existing.normalizedState?.trim()
          ? existing.normalizedState
          : normalizedState || existing.normalizedState;
        const nextNiche = existing.nicheKey?.trim() ? existing.nicheKey : nicheKey;
        const nextMeta = {
          ...existingMeta,
          additionalSourceLeadEventIds: additionalIds,
          ...(existingIsCampaign
            ? {
                provenanceKind: CAMPAIGN_PROVENANCE_KIND,
              }
            : {}),
        } as Prisma.JsonObject;

        let nextStatus = existing.status;
        let nextAvailableAt = existing.availableAt;
        if (existing.status === "pending_review" && existing.generatedAt) {
          const promoted = assessCampaignCreateStatus({
            itemId: existing.id,
            event,
            sourceLane: input.sourceLane,
            generatedAt: existing.generatedAt,
            normalizedState: nextState,
            nicheKey: nextNiche,
            productType: existing.productType ?? productType,
            lot: { id: existing.inventoryLotId, status: "active" },
            metadataJson: nextMeta,
            leadProof: null,
            verification: null,
          });
          if (promoted.status === "available") {
            nextStatus = "available";
            nextAvailableAt = promoted.availableAt;
          }
        }

        await tx.leadInventoryItem.update({
          where: { id: existing.id },
          data: {
            phoneFingerprint: existing.phoneFingerprint ?? fingerprints.phoneFingerprint,
            emailFingerprint: existing.emailFingerprint ?? fingerprints.emailFingerprint,
            normalizedState: nextState,
            nicheKey: nextNiche,
            status: nextStatus,
            availableAt: nextAvailableAt,
            metadataJson: nextMeta,
          },
        });

        await recordTrackingOnEvent(
          event.id,
          {
            outcome: outcomeFromMatch(hit.match),
            inventoryItemId: existing.id,
            identityMatch: hit.match,
            commerceEligible,
            lifecycleKey,
            inventoryStatus: nextStatus,
          },
          input.sourceLane,
          tx
        );

        return {
          ok: true as const,
          outcome: outcomeFromMatch(hit.match),
          inventoryItemId: existing.id,
          sourceLeadEventId: event.id,
          sourceLane: input.sourceLane,
          generatedAt: existing.generatedAt?.toISOString() ?? generated.generatedAt?.toISOString() ?? null,
          generatedAtSource: generated.source,
          commerceEligible,
          inventoryStatus: nextStatus === "available" || nextStatus === "pending_review" ? nextStatus : null,
          lifecycleKey,
          identityMatch: hit.match,
          diagnostics,
        };
      }

      if (!generated.generatedAt) {
        await recordTrackingOnEvent(
          event.id,
          {
            outcome: "generated_at_missing",
            commerceEligible: false,
            lifecycleKey,
          },
          input.sourceLane,
          tx
        );
        return {
          ok: true as const,
          outcome: "generated_at_missing" as const,
          inventoryItemId: null,
          sourceLeadEventId: event.id,
          sourceLane: input.sourceLane,
          generatedAt: null,
          generatedAtSource: generated.source,
          commerceEligible: false,
          inventoryStatus: null,
          lifecycleKey,
          identityMatch: null,
          diagnostics,
        };
      }

      const lot = await ensureCampaignInventoryLot(
        {
          sourceLane: input.sourceLane,
          sourceProvider: event.sourceProvider,
          campaignKey: resolveCampaignKey(event),
          campaignName: event.sourceCampaignName,
          formId: event.sourceFunnelName,
          nicheKey,
          productType,
        },
        tx
      );

      const incomingDetails = mergeOptionalSalesContext(
        event.normalizedPayloadJson,
        event.normalizedPayloadJson,
        nicheKey
      );
      const incomingPayload = asRecord(event.normalizedPayloadJson) ?? {};
      await tx.sourceLeadEvent.update({
        where: { id: event.id },
        data: {
          normalizedPayloadJson: {
            ...incomingPayload,
            lead_details: incomingDetails,
          } as Prisma.JsonObject,
        },
      });

      const metadataJson = buildCampaignProvenanceMetadata({
        event,
        sourceLane: input.sourceLane,
        generatedAtSource: generated.source,
        generatedAtMissing: false,
      });
      const activation = assessCampaignCreateStatus({
        itemId: `campaign-intake:${event.id}`,
        event,
        sourceLane: input.sourceLane,
        generatedAt: generated.generatedAt,
        normalizedState: normalizedState || "UN",
        nicheKey,
        productType,
        lot,
        metadataJson,
        leadProof: null,
        verification: null,
      });

      const created = await tx.leadInventoryItem.create({
        data: {
          inventoryLotId: lot.id,
          sourceLeadEventId: event.id,
          generatedAt: generated.generatedAt,
          normalizedState: normalizedState || "UN",
          nicheKey,
          productType,
          sourceProvider: event.sourceProvider,
          sourceLane: input.sourceLane,
          inventoryClass: "aged",
          exclusivityMode: "configurable",
          status: activation.status,
          availableAt: activation.availableAt,
          phoneFingerprint: fingerprints.phoneFingerprint,
          emailFingerprint: fingerprints.emailFingerprint,
          metadataJson: {
            ...metadataJson,
            intakeActivation: {
              status: activation.status,
              blockerCodes: activation.blockerCodes,
            },
          },
        },
      });

      await recordTrackingOnEvent(
        event.id,
        {
          outcome: "created",
          inventoryItemId: created.id,
          commerceEligible,
          lifecycleKey,
          inventoryStatus: created.status,
        },
        input.sourceLane,
        tx
      );

      return {
        ok: true as const,
        outcome: "created" as const,
        inventoryItemId: created.id,
        sourceLeadEventId: event.id,
        sourceLane: input.sourceLane,
        generatedAt: generated.generatedAt.toISOString(),
        generatedAtSource: generated.source,
        commerceEligible,
        inventoryStatus: activation.status,
        lifecycleKey,
        identityMatch: null,
        diagnostics,
      };
    });
      } catch (err) {
        attempt += 1;
        if (attempt > 2 || !isRetryableInventoryConflict(err)) throw err;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "inventory_tracking_failed";
    logger.warn("campaign_inventory.tracking_failed", {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLane: input.sourceLane,
      error: message,
    });
    try {
      await recordTrackingOnEvent(
        input.sourceLeadEventId,
        {
          outcome: "inventory_tracking_failed",
          error: message,
        },
        input.sourceLane,
        db
      );
    } catch {
      // Event persistence already succeeded; failure state is best-effort.
    }
    return {
      ok: false,
      code: "inventory_tracking_failed",
      sourceLeadEventId: input.sourceLeadEventId,
      reasons: [message],
    };
  }
}

export async function trackCampaignInventorySafely(
  input: {
    sourceLeadEventId: string;
    sourceLane: CampaignInventorySourceLane;
  },
  db: PrismaClient = defaultPrisma
): Promise<CampaignInventoryTrackingResult> {
  return trackCampaignInventoryFromSourceEvent(input, db);
}
