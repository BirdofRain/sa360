import assert from "node:assert/strict";
import test from "node:test";

import type { SourceFunnelAdminItem } from "./source-funnels.ts";
import {
  buildOnboardingDiscovery,
  type OnboardingDiscoveryInput,
} from "./onboarding-discovery.ts";

function source(partial: Partial<SourceFunnelAdminItem> & { id: string }): SourceFunnelAdminItem {
  return {
    provider: "leadcapture_io",
    providerFunnelId: null,
    parentUrlKey: null,
    pageSlug: null,
    observedFunnelName: null,
    nicheKey: null,
    associationStatus: "confirmed",
    suggestedClientAccountId: null,
    originClientAccountId: "ray_rodriguez",
    firstSeenAt: null,
    lastSeenAt: null,
    ...partial,
  };
}

function input(overrides: Partial<OnboardingDiscoveryInput> = {}): OnboardingDiscoveryInput {
  return {
    client: {
      clientDisplayName: "Ray Rodriguez",
      createdAt: "2026-01-04T15:00:00.000Z",
      ghlDestination: null,
      routingRules: [],
    },
    sources: { availability: "ready", items: [] },
    setup: {
      availability: "ready",
      status: "setup_reviewed",
      revision: 4,
      destinationChoice: "google_sheets",
      operatorNotes: { webhookConfigured: true, sourceTestSubmitted: true, setupReviewed: true },
    },
    sheetsDestination: { availability: "ready", destination: null },
    googleConnection: {
      availability: "ready",
      email: "sheets@example.com",
      connectionStatus: "connected",
      rootFolderTitle: "Client Folders",
    },
    clientFolder: { availability: "ready", title: null, url: null, spreadsheets: [], links: [] },
    sheetsDispatch: { availability: "ready", campaignDispatchEnabled: false, agedDispatchEnabled: false },
    sourceProof: {
      availability: "ready",
      evidenceTruncated: false,
      sources: [],
      fieldMapVerified: false,
      writerReceiptVerified: false,
    },
    ...overrides,
  };
}

function state(model: ReturnType<typeof buildOnboardingDiscovery>, id: string) {
  const check = model.checks.find((item) => item.id === id);
  assert.ok(check, id);
  return check;
}

test("multiple stored sources stay distinct and missing ids stay unknown", () => {
  const model = buildOnboardingDiscovery(
    input({
      sources: {
        availability: "ready",
        items: [
          source({
            id: "funnel_facebook",
            observedFunnelName: "Veteran page",
            parentUrlKey: "quotes.example.com/veteran",
            providerFunnelId: null,
            firstSeenAt: "2026-02-01T15:00:00.000Z",
            lastSeenAt: "2026-03-01T15:00:00.000Z",
            associationStatus: "confirmed",
          }),
          source({
            id: "funnel_waiting",
            observedFunnelName: "Second page",
            pageSlug: "second-page",
            associationStatus: "suggested",
          }),
        ],
      },
      sourceProof: {
        availability: "ready",
        evidenceTruncated: false,
        fieldMapVerified: false,
        writerReceiptVerified: false,
        sources: [
          {
            sourceFunnelId: "funnel_facebook",
            sourceKind: "zapier_facebook",
            observedEventId: "evt_real_lead",
            observedAt: "2026-03-01T15:04:00.000Z",
            matchedRuleId: "rule_vet",
            deliverySatisfied: false,
          },
        ],
      },
      client: {
        clientDisplayName: "Ray Rodriguez",
        createdAt: "2026-01-04T15:00:00.000Z",
        ghlDestination: null,
        routingRules: [
          {
            id: "rule_vet",
            campaignId: "camp_123",
            campaignName: "Veteran Search",
            utmCampaign: "vet-search",
            active: true,
            deliveryEnabled: false,
          },
          {
            id: "rule_other",
            campaignId: null,
            campaignName: null,
            utmCampaign: null,
            active: false,
            deliveryEnabled: false,
          },
        ],
      },
    })
  );

  assert.deepEqual(
    model.sources.map((item) => item.id),
    ["funnel_facebook", "funnel_waiting"]
  );
  const facebook = model.sources[0]!;
  assert.equal(facebook.trafficPlatform, "Facebook");
  assert.equal(facebook.publicUrl, "quotes.example.com/veteran");
  assert.equal(facebook.providerFunnelId, null);
  assert.equal(facebook.providerLeadUuid, null);
  assert.equal(facebook.sourceEventId, "evt_real_lead");
  assert.equal(facebook.observedSubmissionAt, "2026-03-01T15:04:00.000Z");
  assert.equal(facebook.identified, "yes");
  assert.equal(facebook.observed, "yes");
  assert.equal(facebook.associated, "yes");
  assert.equal(facebook.verified, "yes");
  assert.deepEqual(
    facebook.campaignIdentifiers.map((item) => item.value),
    ["camp_123", "Veteran Search", "vet-search"]
  );

  const waiting = model.sources[1]!;
  assert.equal(waiting.trafficPlatform, null);
  assert.equal(waiting.publicUrl, null);
  assert.equal(waiting.providerFunnelId, null);
  assert.equal(waiting.associated, "no");
  assert.equal(waiting.associationStatus, "suggested");
  assert.equal(waiting.observed, "no");
  assert.equal(waiting.verified, "no");
  assert.deepEqual(waiting.campaignIdentifiers, []);
  assert.equal(model.clientCampaigns[1]?.campaignId, null);
  assert.equal(model.readOnly, true);
  assert.equal("save" in model, false);
});

test("a form vendor and a review checkbox do not verify or assign a traffic platform", () => {
  const model = buildOnboardingDiscovery(
    input({
      sources: {
        availability: "ready",
        items: [
          source({
            id: "funnel_form",
            provider: "facebook_form_vendor",
            parentUrlKey: "my.leadcapture.io/p/form",
            providerFunnelId: "form_1",
            associationStatus: "confirmed",
            firstSeenAt: "2026-04-01T12:00:00.000Z",
            lastSeenAt: "2026-04-02T12:00:00.000Z",
          }),
        ],
      },
    })
  );

  assert.equal(model.sources[0]?.trafficPlatform, null);
  assert.equal(model.sources[0]?.verified, "no");
  assert.equal(state(model, "delivery_receipt").state, "no");
  assert.equal(state(model, "controlled_test").state, "unknown");
  assert.match(state(model, "controlled_test").detail, /not a controlled test/i);
  assert.equal(state(model, "association_confirmed").state, "yes");
  assert.equal(state(model, "lead_observed").state, "yes");
});

test("an unavailable source read and a truncated proof stay unknown", () => {
  const unavailable = buildOnboardingDiscovery(
    input({
      sources: { availability: "unavailable", items: [] },
      sourceProof: {
        availability: "disabled",
        evidenceTruncated: false,
        sources: [],
        fieldMapVerified: null,
        writerReceiptVerified: null,
      },
    })
  );
  assert.equal(state(unavailable, "source_identified").state, "unknown");
  assert.equal(state(unavailable, "lead_observed").state, "unknown");
  assert.equal(state(unavailable, "association_confirmed").state, "unknown");
  assert.equal(state(unavailable, "delivery_receipt").state, "unknown");
  assert.equal(state(unavailable, "controlled_test").state, "unknown");

  const truncated = buildOnboardingDiscovery(
    input({
      sources: {
        availability: "ready",
        items: [source({ id: "funnel_hidden", parentUrlKey: "example.com/hidden" })],
      },
      sourceProof: {
        availability: "ready",
        evidenceTruncated: true,
        sources: [],
        fieldMapVerified: null,
        writerReceiptVerified: null,
      },
    })
  );
  assert.equal(truncated.sources[0]?.verified, "unknown");
  assert.equal(state(truncated, "published_column_map").state, "unknown");
  assert.equal(state(truncated, "field_value_validation").state, "unknown");
  assert.equal(state(truncated, "source_event_recorded").state, "unknown");
});

test("a requested spreadsheet is not an operational destination", () => {
  const model = buildOnboardingDiscovery(input());
  assert.equal(model.requestedDestination.choice, "google_sheets");
  assert.equal(model.sheets.configured, false);
  assert.equal(state(model, "destination_configured").state, "no");
  assert.match(state(model, "destination_configured").detail, /not a destination/);
  assert.equal(model.clientFolder.title, null);
  assert.equal(model.google.rootFolderTitle, "Client Folders");
});

test("sheets access, a published map, and a superseded link stay separate", () => {
  const denied = buildOnboardingDiscovery(
    input({
      client: {
        clientDisplayName: "Ray Rodriguez",
        createdAt: "2026-01-04T15:00:00.000Z",
        ghlDestination: {
          destinationSubaccountIdGhl: "loc_ray",
          locationName: "Ray Rodriguez",
          ghlConnectionStatus: "connected",
          deliveryEnabled: false,
          fieldMappingComplete: null,
        },
        routingRules: [],
      },
      sheetsDestination: {
        availability: "ready",
        destination: {
          spreadsheetId: "sheet_current",
          spreadsheetTitle: "Ray Rodriguez Leads",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_current",
          worksheetTitle: "Campaign",
          accessStatus: "permission_denied",
          writeReadiness: "permission_denied",
          revision: 7,
          sharingEmail: "ray@example.com",
          sharingPermission: "not_granted",
        },
      },
      clientFolder: {
        availability: "ready",
        title: "Ray Rodriguez",
        url: "https://drive.google.com/drive/folders/folder_ray",
        spreadsheets: [
          {
            spreadsheetId: "sheet_current",
            title: "Ray Rodriguez Leads",
            url: "https://docs.google.com/spreadsheets/d/sheet_current",
          },
        ],
        links: [
          {
            spreadsheetId: "sheet_old",
            title: "Old workbook",
            url: "https://docs.google.com/spreadsheets/d/sheet_old",
            supersededAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
      sourceProof: {
        availability: "ready",
        evidenceTruncated: false,
        sources: [],
        fieldMapVerified: false,
        writerReceiptVerified: false,
      },
    })
  );

  assert.equal(denied.sheets.revision, 7);
  assert.equal(denied.sheets.accessStatus, "permission_denied");
  assert.equal(denied.sheets.superseded[0]?.spreadsheetId, "sheet_old");
  assert.equal(state(denied, "permissions_verified").state, "no");
  assert.equal(state(denied, "published_column_map").state, "no");
  assert.match(state(denied, "published_column_map").detail, /field values were not validated/i);
  assert.equal(denied.sheets.sharingPermission, "not_granted");

  const verified = buildOnboardingDiscovery(
    input({
      sheetsDestination: {
        availability: "ready",
        destination: {
          spreadsheetId: "sheet_current",
          spreadsheetTitle: "Ray Rodriguez Leads",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_current",
          worksheetTitle: "Campaign",
          accessStatus: "verified",
          writeReadiness: "verified",
          revision: 8,
          sharingEmail: null,
          sharingPermission: "not_granted",
        },
      },
      sourceProof: {
        availability: "ready",
        evidenceTruncated: false,
        sources: [],
        fieldMapVerified: true,
        writerReceiptVerified: true,
      },
    })
  );
  assert.equal(state(verified, "permissions_verified").state, "yes");
  assert.equal(state(verified, "published_column_map").state, "yes");
  assert.match(state(verified, "published_column_map").detail, /not an end-to-end check/i);
  assert.equal(state(verified, "field_value_validation").state, "unknown");
  assert.equal(state(verified, "delivery_receipt").state, "yes");
  assert.match(state(verified, "delivery_receipt").detail, /not a controlled test/i);
  assert.equal(state(verified, "controlled_test").state, "unknown");
});

test("a connected GoHighLevel status is not permission verification, and live delivery is read from stored flags", () => {
  const connected = buildOnboardingDiscovery(
    input({
      client: {
        clientDisplayName: "Ray Rodriguez",
        createdAt: "2026-01-04T15:00:00.000Z",
        ghlDestination: {
          destinationSubaccountIdGhl: "loc_ray",
          locationName: "Ray Rodriguez",
          ghlConnectionStatus: "connected",
          deliveryEnabled: false,
          fieldMappingComplete: null,
        },
        routingRules: [],
      },
      sheetsDestination: { availability: "unavailable", destination: null },
      sheetsDispatch: { availability: "unavailable", campaignDispatchEnabled: false, agedDispatchEnabled: false },
    })
  );
  assert.equal(state(connected, "destination_configured").state, "yes");
  assert.equal(state(connected, "permissions_verified").state, "unknown");
  assert.match(state(connected, "permissions_verified").detail, /not a permission verification/);
  assert.equal(state(connected, "stored_delivery_flag").state, "unknown");
  assert.match(state(connected, "stored_delivery_flag").detail, /does not report whether an earlier delivery succeeded/);

  const live = buildOnboardingDiscovery(
    input({
      client: {
        clientDisplayName: "Ray Rodriguez",
        createdAt: "2026-01-04T15:00:00.000Z",
        ghlDestination: {
          destinationSubaccountIdGhl: "loc_ray",
          locationName: "Ray Rodriguez",
          ghlConnectionStatus: "connected",
          deliveryEnabled: true,
          fieldMappingComplete: true,
        },
        routingRules: [],
      },
    })
  );
  assert.equal(state(live, "stored_delivery_flag").state, "yes");
  assert.equal(state(live, "stored_delivery_flag").statusLabel, "On");
  assert.match(state(live, "stored_delivery_flag").detail, /stored flag does not show that delivery ran/);
  assert.doesNotMatch(state(live, "stored_delivery_flag").detail, /succeeded|executed/);
  assert.equal(live.ghl.deliveryEnabled, true);
});

test("a delivery receipt, a column map, a stored flag, and partial sources stay distinct", () => {
  const model = buildOnboardingDiscovery(
    input({
      client: {
        clientDisplayName: "Ray Rodriguez",
        createdAt: "2026-01-04T15:00:00.000Z",
        ghlDestination: {
          destinationSubaccountIdGhl: "loc_ray",
          locationName: "Ray Rodriguez",
          ghlConnectionStatus: "connected",
          deliveryEnabled: true,
          fieldMappingComplete: true,
        },
        routingRules: [],
      },
      sources: {
        availability: "ready",
        items: [
          source({
            id: "seen",
            parentUrlKey: "example.com/seen",
            providerFunnelId: "form_seen",
            firstSeenAt: "2026-02-01T00:00:00.000Z",
            lastSeenAt: "2026-02-02T00:00:00.000Z",
            associationStatus: "confirmed",
          }),
          source({ id: "quiet", associationStatus: "suggested" }),
        ],
      },
      sourceProof: {
        availability: "ready",
        evidenceTruncated: false,
        fieldMapVerified: false,
        writerReceiptVerified: true,
        sources: [
          {
            sourceFunnelId: "seen",
            sourceKind: "leadcapture",
            observedEventId: "evt_seen",
            observedAt: "2026-02-02T00:00:00.000Z",
            matchedRuleId: null,
            deliverySatisfied: true,
          },
        ],
      },
      sheetsDestination: { availability: "ready", destination: null },
    })
  );

  assert.equal(state(model, "delivery_receipt").state, "yes");
  assert.equal(state(model, "delivery_receipt").statusLabel, "Recorded");
  assert.match(state(model, "delivery_receipt").detail, /historical delivery evidence, not a controlled test/);
  assert.match(state(model, "delivery_receipt").detail, /Sheets writer receipt/);
  assert.equal(state(model, "controlled_test").state, "unknown");
  assert.equal(state(model, "controlled_test").statusLabel, "Unknown");
  assert.equal(state(model, "published_column_map").state, "no");
  assert.match(state(model, "published_column_map").detail, /not a published column map/);
  assert.match(state(model, "published_column_map").detail, /does not validate delivered values/);
  assert.equal(state(model, "field_value_validation").state, "unknown");
  assert.equal(state(model, "stored_delivery_flag").statusLabel, "On");
  assert.match(state(model, "stored_delivery_flag").detail, /does not show that delivery ran or that a lead was delivered/);
  assert.equal(state(model, "source_identified").statusLabel, "Partial");
  assert.match(state(model, "source_identified").detail, /1 of 2 stored sources have a page identity\. The other source does not/);
  assert.match(state(model, "lead_observed").detail, /1 of 2 stored sources have a first lead time/);
  assert.match(state(model, "association_confirmed").detail, /1 of 2 stored sources have a confirmed association/);
  assert.match(state(model, "source_event_recorded").detail, /1 of 2 stored sources have a source event id/);
});

test("a failed sheets read is not reported as an empty destination", () => {
  const model = buildOnboardingDiscovery(
    input({
      sheetsDestination: { availability: "unavailable", destination: null },
      clientFolder: { availability: "unavailable", title: null, url: null, spreadsheets: [], links: [] },
      googleConnection: { availability: "unavailable", email: null, connectionStatus: null, rootFolderTitle: null },
      setup: { availability: "unavailable", status: null, revision: null, destinationChoice: null },
    })
  );
  assert.equal(model.sheets.configured, null);
  assert.equal(state(model, "destination_configured").state, "unknown");
  assert.equal(model.requestedDestination.availability, "unavailable");
  assert.equal(model.clientFolder.spreadsheets, null);
});
