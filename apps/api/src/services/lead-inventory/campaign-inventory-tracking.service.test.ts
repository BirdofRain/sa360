import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { trackCampaignInventoryFromSourceEvent } from "./campaign-inventory-tracking.service.js";

const PHONE = "+15550100001";
const EMAIL = "campaign@example.test";
const phoneFingerprint = fingerprintIdentityValue("phone", PHONE);
const emailFingerprint = fingerprintIdentityValue("email", EMAIL);

type EventRow = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceLeadId: string | null;
  sourceLeadUid: string | null;
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  sourceFunnelName: string | null;
  sourceRouteKey: string | null;
  normalizedPayloadJson: Record<string, unknown> | null;
  enrichmentMetadataJson: Record<string, unknown> | null;
  receivedAt: Date;
};

type ItemRow = {
  id: string;
  sourceLeadEventId: string;
  sourceLane: string;
  nicheKey: string;
  normalizedState: string;
  generatedAt: Date | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
  status?: string;
  availableAt?: Date | null;
  inventoryLotId?: string;
  productType?: string | null;
};

function campaignPayload(overrides: Record<string, unknown> = {}) {
  return {
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      phone_e164: PHONE,
      email: EMAIL,
      state: "TX",
      ...((overrides.contact as object) ?? {}),
    },
    routing: {
      niche_key: "VET",
      source_intake: {
        submitted_at: "2026-01-01T00:00:00.000Z",
        generated_at: "2026-01-01T00:00:00.000Z",
        campaign_id: "camp_1",
        form_id: "form_1",
        ...((overrides.source_intake as object) ?? {}),
      },
    },
    lead_details: overrides.lead_details ?? {
      beneficiary: "Spouse",
      coverage_amount: "15000",
      niche: { branch_of_service: "Army" },
    },
    attribution: {
      campaign_id: "camp_1",
      adset_id: "adset_1",
      ad_id: "ad_1",
      utm_campaign: "vet-fex",
    },
  };
}

function createTrackingFake(seed?: { events?: EventRow[]; items?: ItemRow[] }) {
  const events = new Map<string, EventRow>((seed?.events ?? []).map((row) => [row.id, row]));
  const items = new Map<string, ItemRow>((seed?.items ?? []).map((row) => [row.id, row]));
  const lots = new Map<string, { id: string; lotKey: string }>();
  let itemSeq = items.size + 1;
  const queryNames: string[] = [];

  const tx = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = String.raw({ raw: strings });
      if (sql.includes("pg_advisory_xact_lock")) return 1;
      return 0;
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = String.raw({ raw: strings });
      if (sql.includes("pg_advisory_xact_lock")) return [{ locked: true }];
      if (sql.includes("LIMIT 1")) {
        queryNames.push("historical_json_compat");
        for (const item of items.values()) {
          if (item.phoneFingerprint) continue;
          const event = events.get(item.sourceLeadEventId);
          const payload = event?.normalizedPayloadJson;
          const phone =
            (payload?.phone_e164 as string | undefined) ??
            ((payload?.contact as { phone_e164?: string } | undefined)?.phone_e164);
          if (phone === PHONE) {
            return [{ id: item.id, sourceLeadEventId: item.sourceLeadEventId }];
          }
        }
      }
      return [];
    },
    sourceLeadEvent: {
      findUnique: async ({ where }: { where: { id: string } }) => events.get(where.id) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { sourceLeadId?: string; leadInventoryItem?: { isNot: null } };
      }) => {
        queryNames.push("sourceLeadEvent.findFirst");
        for (const event of events.values()) {
          if (where.sourceLeadId && event.sourceLeadId !== where.sourceLeadId) continue;
          const linked = [...items.values()].find((item) => item.sourceLeadEventId === event.id);
          if (where.leadInventoryItem && !linked) continue;
          return linked ? { id: event.id, leadInventoryItem: { id: linked.id } } : null;
        }
        return null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { normalizedPayloadJson?: Record<string, unknown>; enrichmentMetadataJson?: Record<string, unknown> };
      }) => {
        const current = events.get(where.id);
        if (!current) return null;
        const next = {
          ...current,
          normalizedPayloadJson: data.normalizedPayloadJson ?? current.normalizedPayloadJson,
          enrichmentMetadataJson: data.enrichmentMetadataJson ?? current.enrichmentMetadataJson,
        };
        events.set(where.id, next);
        return next;
      },
    },
    leadInventoryItem: {
      findUnique: async ({ where }: { where: { id?: string; sourceLeadEventId?: string } }) => {
        queryNames.push("leadInventoryItem.findUnique");
        if (where.id) {
          const item = items.get(where.id);
          if (!item) return null;
          return { ...item, sourceLeadEvent: events.get(item.sourceLeadEventId) };
        }
        if (where.sourceLeadEventId) {
          const item = [...items.values()].find((row) => row.sourceLeadEventId === where.sourceLeadEventId);
          return item ? { id: item.id, sourceLeadEventId: item.sourceLeadEventId } : null;
        }
        return null;
      },
      findFirst: async ({ where }: { where: { phoneFingerprint?: string; emailFingerprint?: string } }) => {
        queryNames.push("leadInventoryItem.findFirst");
        const item = [...items.values()].find((row) => {
          if (where.phoneFingerprint) return row.phoneFingerprint === where.phoneFingerprint;
          if (where.emailFingerprint) return row.emailFingerprint === where.emailFingerprint;
          return false;
        });
        return item ? { id: item.id, sourceLeadEventId: item.sourceLeadEventId } : null;
      },
      create: async ({ data }: { data: ItemRow }) => {
        const row: ItemRow = {
          ...data,
          id: data.id ?? `inv_${itemSeq++}`,
          createdAt: new Date(),
        };
        items.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ItemRow> }) => {
        const current = items.get(where.id);
        if (!current) return null;
        const next = { ...current, ...data };
        items.set(where.id, next);
        return next;
      },
    },
    inventoryLot: {
      findUnique: async ({ where }: { where: { lotKey: string } }) => lots.get(where.lotKey) ?? null,
      create: async ({ data }: { data: { lotKey: string } }) => {
        const row = { id: `lot_${lots.size + 1}`, lotKey: data.lotKey };
        lots.set(data.lotKey, row);
        return row;
      },
    },
  };

  const db = {
    ...tx,
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return { db, events, items, queryNames };
}

function seedEvent(id: string, overrides: Partial<EventRow> = {}): EventRow {
  return {
    id,
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceLeadId: "leadgen_1",
    sourceLeadUid: "facebook-meta_lead_ads-leadgen_1",
    sourceCampaignId: "camp_1",
    sourceCampaignName: "Vet FEX",
    sourceFunnelName: "form_1",
    sourceRouteKey: "form_1",
    normalizedPayloadJson: campaignPayload(),
    enrichmentMetadataJson: {},
    receivedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("Meta new lead creates inventory exactly once", async () => {
  const event = seedEvent("evt_meta_1");
  const { db, items } = createTrackingFake({ events: [event] });
  const first = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  const second = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.outcome, "created");
  assert.equal(second.outcome, "reused_same_event");
  assert.equal(first.inventoryItemId, second.inventoryItemId);
  assert.equal(items.size, 1);
  assert.equal([...items.values()][0]?.sourceLane, "meta_lead_ads");
  assert.equal([...items.values()][0]?.phoneFingerprint, phoneFingerprint);
  assert.equal([...items.values()][0]?.status, "available");
  assert.equal(first.inventoryStatus, "available");
  assert.equal((first.diagnostics.jsonCorpusScan as boolean), false);
});

test("compliant campaign lead is available immediately and purchasable at day 30 without status rewrite", async () => {
  const event = seedEvent("evt_age_30", {
    normalizedPayloadJson: campaignPayload({
      source_intake: {
        submitted_at: "2026-07-08T00:00:00.000Z",
        generated_at: "2026-07-08T00:00:00.000Z",
      },
    }),
  });
  const { db, items } = createTrackingFake({ events: [event] });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok && result.outcome === "created", true);
  const item = [...items.values()][0];
  assert.equal(item?.status, "available");
  const { resolveInventoryCommerceLifecycle, isPurchasableInventoryCommerceLifecycle } = await import(
    "../ppl-fulfillment/commerce-lifecycle.js"
  );
  const lifecycle = resolveInventoryCommerceLifecycle(32);
  assert.equal(isPurchasableInventoryCommerceLifecycle(lifecycle), true);
  assert.equal(item?.status, "available");
});

test("campaign lead without identity stays pending_review", async () => {
  const event = seedEvent("evt_no_id", {
    normalizedPayloadJson: {
      contact: { state: "TX" },
      routing: {
        niche_key: "VET",
        source_intake: {
          submitted_at: "2026-01-01T00:00:00.000Z",
          generated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    },
  });
  const { db, items } = createTrackingFake({ events: [event] });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok && result.outcome === "created", true);
  assert.equal([...items.values()][0]?.status, "pending_review");
  assert.equal(result.ok && result.inventoryStatus === "pending_review", true);
});

test("LeadCapture new lead creates inventory exactly once with recognized lane", async () => {
  const event = seedEvent("evt_lc_1", {
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceLeadId: "11111111-2222-4333-8444-555555555555",
  });
  const { db, items } = createTrackingFake({ events: [event] });
  const first = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
    db as never
  );
  const second = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
    db as never
  );
  assert.equal(first.ok && first.outcome === "created", true);
  assert.equal(second.ok && second.outcome === "reused_same_event", true);
  assert.equal(items.size, 1);
  assert.equal([...items.values()][0]?.sourceLane, "leadcapture_io");
});

test("same sourceLeadId from a new event reuses inventory", async () => {
  const prior = seedEvent("evt_prior");
  const next = seedEvent("evt_replay", { normalizedPayloadJson: campaignPayload() });
  const { db, items } = createTrackingFake({
    events: [prior, next],
    items: [
      {
        id: "inv_prior",
        sourceLeadEventId: prior.id,
        sourceLane: "meta_lead_ads",
        nicheKey: "vet",
        normalizedState: "TX",
        generatedAt: new Date("2026-01-01T00:00:00.000Z"),
        phoneFingerprint,
        emailFingerprint,
        metadataJson: { provenanceKind: "campaign" },
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ],
  });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: next.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "reused_source_lead_id");
  assert.equal(result.inventoryItemId, "inv_prior");
  assert.equal(items.size, 1);
  const additional = ([...items.values()][0]?.metadataJson.additionalSourceLeadEventIds ?? []) as string[];
  assert.ok(additional.includes(next.id));
});

test("same phone from another source reuses inventory and retains new event context", async () => {
  const historical = seedEvent("evt_hist", {
    sourceProvider: "manual_import",
    sourceSystem: "csv_import",
    sourceLeadId: "csv-1",
  });
  const incoming = seedEvent("evt_new_src", {
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_legacy",
    sourceLeadId: "lc-new",
    normalizedPayloadJson: campaignPayload({
      lead_details: { beneficiary: "Child", coverage_amount: "", niche: { disability_rating: "40%" } },
    }),
  });
  const { db, items, events } = createTrackingFake({
    events: [historical, incoming],
    items: [
      {
        id: "inv_hist",
        sourceLeadEventId: historical.id,
        sourceLane: "aged_inventory_csv",
        nicheKey: "vet",
        normalizedState: "TX",
        generatedAt: new Date("2025-01-01T00:00:00.000Z"),
        phoneFingerprint,
        emailFingerprint: null,
        metadataJson: { importRequestId: "req-import-1" },
        createdAt: new Date("2025-01-02T00:00:00.000Z"),
      },
    ],
  });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: incoming.id, sourceLane: "leadcapture_io" },
    db as never
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "reused_phone");
  assert.equal(items.size, 1);
  assert.equal([...items.values()][0]?.metadataJson.importRequestId, "req-import-1");
  const canonical = events.get(historical.id)?.normalizedPayloadJson as {
    lead_details?: { beneficiary?: string; niche?: { disability_rating?: string } };
  };
  assert.equal(canonical.lead_details?.beneficiary, "Spouse");
  assert.equal(canonical.lead_details?.niche?.disability_rating, "40%");
  const incomingStored = events.get(incoming.id)?.normalizedPayloadJson as {
    lead_details?: { beneficiary?: string };
  };
  assert.equal(incomingStored.lead_details?.beneficiary, "Child");
});

test("same email from another event reuses inventory", async () => {
  const prior = seedEvent("evt_email_prior", {
    sourceLeadId: "other-id",
    normalizedPayloadJson: campaignPayload({ contact: { phone_e164: "+15550999999" } }),
  });
  const incoming = seedEvent("evt_email_new", {
    sourceLeadId: "brand-new",
    normalizedPayloadJson: campaignPayload({ contact: { phone_e164: "+15550888888" } }),
  });
  const { db, items } = createTrackingFake({
    events: [prior, incoming],
    items: [
      {
        id: "inv_email",
        sourceLeadEventId: prior.id,
        sourceLane: "meta_lead_ads",
        nicheKey: "vet",
        normalizedState: "TX",
        generatedAt: new Date("2026-01-01T00:00:00.000Z"),
        phoneFingerprint: fingerprintIdentityValue("phone", "+15550999999"),
        emailFingerprint,
        metadataJson: { provenanceKind: "campaign" },
        createdAt: new Date(),
      },
    ],
  });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: incoming.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok && result.outcome === "reused_email", true);
  assert.equal(items.size, 1);
});

test("missing authoritative generated date fails commerce eligibility safely", async () => {
  const event = seedEvent("evt_nodate", {
    normalizedPayloadJson: {
      contact: { phone_e164: PHONE, email: EMAIL, state: "TX" },
      routing: { niche_key: "VET", source_intake: {} },
    },
  });
  const { db, items } = createTrackingFake({ events: [event] });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.outcome, "generated_at_missing");
  assert.equal(result.inventoryItemId, null);
  assert.equal(result.commerceEligible, false);
  assert.equal(result.lifecycleKey, "DATE_MISSING");
  assert.equal(items.size, 0);
  assert.equal(event.receivedAt.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("blank optional context is harmless and supplied context is retained", async () => {
  const event = seedEvent("evt_optional", {
    normalizedPayloadJson: campaignPayload({
      lead_details: {},
    }),
  });
  const { db, events } = createTrackingFake({ events: [event] });
  const result = await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  assert.equal(result.ok && result.outcome === "created", true);
  const stored = events.get(event.id)?.normalizedPayloadJson as { lead_details?: object };
  assert.ok(stored.lead_details);
});

test("campaign metadata never invents importRequestId", async () => {
  const event = seedEvent("evt_prov");
  const { db, items } = createTrackingFake({ events: [event] });
  await trackCampaignInventoryFromSourceEvent(
    { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
    db as never
  );
  const meta = [...items.values()][0]?.metadataJson ?? {};
  assert.equal(meta.provenanceKind, "campaign");
  assert.equal("importRequestId" in meta, false);
  assert.equal(meta.sourceLeadEventId, event.id);
});
