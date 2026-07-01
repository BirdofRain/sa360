import test from "node:test";
import assert from "node:assert/strict";
import type { UnifiedLeadDeliveryDetail, UnifiedLeadDeliveryListRow } from "@/lib/lead-delivery-read-model/types";
import type { SourceLeadListItem } from "@/lib/source-intake/types";
import {
  getLeadDeliveryListLiveWithFetchers,
  getLeadDeliveryListUnifiedWithFetchers,
  type LeadDeliveryFetchers,
} from "./lead-delivery-bridge";

const unifiedItem: UnifiedLeadDeliveryListRow = {
  id: "evt_unified",
  sourceLeadId: "sl_1",
  leadUid: "uid_1",
  contactIdGhl: null,
  clientAccountId: "client_a",
  clientDisplayName: "Summit Insurance",
  subaccountIdGhl: null,
  leadName: "Jane Doe",
  phoneMasked: "(555) ***-4567",
  phoneE164: "+15551234567",
  emailMasked: "jane@example.com",
  email: "jane@example.com",
  sourcePlatform: "facebook",
  sourceType: "lead_form",
  campaignId: "camp_1",
  campaignName: "Spring",
  adId: null,
  adName: null,
  receivedAt: "2026-06-01T10:00:00.000Z",
  lastEventAt: "2026-06-01T10:02:00.000Z",
  lastEventName: "lead_routed",
  matchedClient: "Summit Insurance",
  routingStatus: "matched",
  deliveryStatus: "not_started",
  ghlContactStatus: "not_created",
  workflowStarted: null,
  appointmentStatus: null,
  soldStatus: null,
  errorCode: null,
  errorSummary: null,
  warnings: [],
  dataSource: "partial_live",
};

const legacyItem: SourceLeadListItem = {
  id: "evt_legacy",
  receivedAt: "2026-06-01T10:00:00.000Z",
  sourceProvider: "facebook",
  sourceSystem: "meta_lead_ads",
  sourceType: "lead_form",
  sourceRouteKey: "camp",
  leadName: "Legacy Lead",
  email: null,
  phone: null,
  status: "routing_matched",
  matched: true,
  matchedRuleId: "rule_1",
  destinationClientAccountId: "client_a",
  destinationLocationIdGhl: null,
  errorSummary: null,
};

test("getLeadDeliveryListUnifiedWithFetchers maps unified rows", async () => {
  const fetchers: LeadDeliveryFetchers = {
    fetchUnifiedList: async () => ({ items: [unifiedItem], error: null }),
    fetchUnifiedDetail: async () => ({ item: null, error: null }),
    fetchLegacyList: async () => ({ items: [], error: "skip" }),
    fetchLegacyDetail: async () => ({ item: null, error: null }),
    fetchTimeline: async () => ({ timeline: null }),
  };

  const result = await getLeadDeliveryListUnifiedWithFetchers({ role: "admin" }, fetchers);
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.leadUid, "evt_unified");
  assert.equal(result.dataSource, "partial_live");
});

test("getLeadDeliveryListLiveWithFetchers falls back when unified endpoint fails", async () => {
  let unifiedCalled = false;
  const fetchers: LeadDeliveryFetchers = {
    fetchUnifiedList: async () => {
      unifiedCalled = true;
      return { items: [], error: "unavailable" };
    },
    fetchUnifiedDetail: async () => ({ item: null, error: null }),
    fetchLegacyList: async () => ({ items: [legacyItem], error: null }),
    fetchLegacyDetail: async () => ({ item: null, error: null }),
    fetchTimeline: async () => ({ timeline: null }),
  };

  const result = await getLeadDeliveryListLiveWithFetchers({ role: "admin" }, fetchers);
  assert.ok(result);
  assert.equal(result.rows[0]?.leadUid, "evt_legacy");
  assert.equal(result.dataSource, "live");
  assert.equal(unifiedCalled, true);
});

test("empty unified list returns live empty state", async () => {
  const fetchers: LeadDeliveryFetchers = {
    fetchUnifiedList: async () => ({ items: [], error: null }),
    fetchUnifiedDetail: async () => ({ item: null, error: null }),
    fetchLegacyList: async () => ({ items: [], error: "should not be called" }),
    fetchLegacyDetail: async () => ({ item: null, error: null }),
    fetchTimeline: async () => ({ timeline: null }),
  };

  const result = await getLeadDeliveryListLiveWithFetchers({ role: "admin" }, fetchers);
  assert.ok(result);
  assert.deepEqual(result.rows, []);
  assert.equal(result.dataSource, "live");
});

test("unified detail maps timeline entries", async () => {
  const detail: UnifiedLeadDeliveryDetail = {
    ...unifiedItem,
    attribution: {
      sourceCampaignId: null,
      sourceCampaignName: null,
      sourceFunnelName: null,
      adId: null,
      adName: null,
      sourceAttributes: {},
    },
    routing: {},
    delivery: {},
    lifecycle: {},
    timeline: [{ milestone: "source_lead_received", at: unifiedItem.receivedAt, status: "complete" }],
  };

  const fetchers: LeadDeliveryFetchers = {
    fetchUnifiedList: async () => ({ items: [], error: null }),
    fetchUnifiedDetail: async () => ({ item: detail, error: null }),
    fetchLegacyList: async () => ({ items: [], error: null }),
    fetchLegacyDetail: async () => ({ item: null, error: null }),
    fetchTimeline: async () => ({ timeline: null }),
  };

  const { getLeadDeliveryDetailLiveWithFetchers } = await import("./lead-delivery-bridge");
  const result = await getLeadDeliveryDetailLiveWithFetchers("evt_unified", { role: "admin" }, fetchers);
  assert.ok(result);
  assert.equal(result.timeline.length, 1);
});
