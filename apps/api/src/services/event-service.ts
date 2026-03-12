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
      payloadJson: payload,
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

export async function upsertLeadAttribution(payload: LifecycleEventSchema) {
  return prisma.leadAttribution.upsert({
    where: { leadUid: payload.contact.lead_uid },
    update: {
      contactIdGhl: payload.contact.contact_id_ghl,
      sourcePlatform: payload.attribution.source_platform,
      sourceType: payload.attribution.source_type,
      campaignId: payload.attribution.campaign_id,
      campaignName: payload.attribution.campaign_name,
      adsetId: payload.attribution.adset_id,
      adsetName: payload.attribution.adset_name,
      adId: payload.attribution.ad_id,
      adName: payload.attribution.ad_name,
      fbclid: payload.attribution.fbclid,
      utmSource: payload.attribution.utm_source,
      utmMedium: payload.attribution.utm_medium,
      utmCampaign: payload.attribution.utm_campaign,
      utmContent: payload.attribution.utm_content,
      utmTerm: payload.attribution.utm_term,
      latestTouchAt: new Date(),
    },
    create: {
      leadUid: payload.contact.lead_uid,
      contactIdGhl: payload.contact.contact_id_ghl,
      sourcePlatform: payload.attribution.source_platform,
      sourceType: payload.attribution.source_type,
      campaignId: payload.attribution.campaign_id,
      campaignName: payload.attribution.campaign_name,
      adsetId: payload.attribution.adset_id,
      adsetName: payload.attribution.adset_name,
      adId: payload.attribution.ad_id,
      adName: payload.attribution.ad_name,
      fbclid: payload.attribution.fbclid,
      utmSource: payload.attribution.utm_source,
      utmMedium: payload.attribution.utm_medium,
      utmCampaign: payload.attribution.utm_campaign,
      utmContent: payload.attribution.utm_content,
      utmTerm: payload.attribution.utm_term,
      firstTouchAt: new Date(),
      latestTouchAt: new Date(),
    },
  });
}