import type { Prisma } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { prisma } from "../lib/db.js";

export async function saveLifecycleEvent(payload: LifecycleEventSchema) {
  return prisma.lifecycleEvent.create({
    data: {
      eventUuid: payload.event.event_uuid,
      clientAccountId: payload.client_account_id,
      subaccountIdGhl: payload.subaccount_id_ghl,
      leadUid: payload.contact.lead_uid,
      contactIdGhl: payload.contact.contact_id_ghl,
      eventNameInternal: payload.event.event_name_internal,
      eventNameMeta: payload.event.event_name_meta,
      payloadJson: payload as unknown as Prisma.InputJsonValue,
      status: "received",
    },
  });
}

export async function lifecycleEventExists(eventUuid: string) {
  const existing = await prisma.lifecycleEvent.findUnique({
    where: { eventUuid },
    select: { id: true },
  });

  return Boolean(existing);
}

/** True when any attribution field is present (duplicate refresh only upserts when this is true). */
export function hasLifecycleAttributionPresent(payload: LifecycleEventSchema): boolean {
  const a = payload.attribution;
  if (!a) {
    return false;
  }
  for (const v of Object.values(a)) {
    if (v === null || v === undefined) {
      continue;
    }
    if (typeof v === "string" && v.trim() !== "") {
      return true;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      return true;
    }
    if (typeof v === "boolean") {
      return true;
    }
  }
  return false;
}

export async function upsertLeadAttribution(payload: LifecycleEventSchema) {
  const attribution = payload.attribution ?? {};
  return prisma.leadAttribution.upsert({
    where: { leadUid: payload.contact.lead_uid },
    update: {
      contactIdGhl: payload.contact.contact_id_ghl,
      sourcePlatform: attribution.source_platform,
      sourceType: attribution.source_type,
      campaignId: attribution.campaign_id,
      campaignName: attribution.campaign_name,
      adsetId: attribution.adset_id,
      adsetName: attribution.adset_name,
      adId: attribution.ad_id,
      adName: attribution.ad_name,
      fbclid: attribution.fbclid,
      utmSource: attribution.utm_source,
      utmMedium: attribution.utm_medium,
      utmCampaign: attribution.utm_campaign,
      utmContent: attribution.utm_content,
      utmTerm: attribution.utm_term,
      latestTouchAt: new Date(),
    },
    create: {
      leadUid: payload.contact.lead_uid,
      contactIdGhl: payload.contact.contact_id_ghl,
      sourcePlatform: attribution.source_platform,
      sourceType: attribution.source_type,
      campaignId: attribution.campaign_id,
      campaignName: attribution.campaign_name,
      adsetId: attribution.adset_id,
      adsetName: attribution.adset_name,
      adId: attribution.ad_id,
      adName: attribution.ad_name,
      fbclid: attribution.fbclid,
      utmSource: attribution.utm_source,
      utmMedium: attribution.utm_medium,
      utmCampaign: attribution.utm_campaign,
      utmContent: attribution.utm_content,
      utmTerm: attribution.utm_term,
      firstTouchAt: new Date(),
      latestTouchAt: new Date(),
    },
  });
}