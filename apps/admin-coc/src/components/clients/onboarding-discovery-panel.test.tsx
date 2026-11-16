import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { buildOnboardingDiscovery, type OnboardingDiscoveryInput } from "@/lib/clients/onboarding-discovery.ts";
import type { SourceFunnelAdminItem } from "@/lib/clients/source-funnels.ts";

let OnboardingDiscoveryPanel: typeof import("./onboarding-discovery-panel.tsx").OnboardingDiscoveryPanel;

test.before(async () => {
  ({ OnboardingDiscoveryPanel } = await import("./onboarding-discovery-panel.tsx"));
});

test.afterEach(cleanup);

function source(partial: Partial<SourceFunnelAdminItem> & { id: string }): SourceFunnelAdminItem {
  return {
    provider: "leadcapture_io",
    providerFunnelId: "form_known",
    parentUrlKey: "quotes.example.com/ray",
    pageSlug: "ray",
    observedFunnelName: "Ray page",
    nicheKey: "vet_fex",
    associationStatus: "confirmed",
    suggestedClientAccountId: null,
    originClientAccountId: "ray_rodriguez",
    firstSeenAt: "2026-02-01T15:00:00.000Z",
    lastSeenAt: "2026-03-01T15:00:00.000Z",
    ...partial,
  };
}

function input(overrides: Partial<OnboardingDiscoveryInput> = {}): OnboardingDiscoveryInput {
  return {
    client: {
      clientDisplayName: "Ray Rodriguez",
      createdAt: "2026-01-04T15:00:00.000Z",
      ghlDestination: {
        destinationSubaccountIdGhl: "loc_ray",
        locationName: "Ray Rodriguez",
        ghlConnectionStatus: "connected",
        deliveryEnabled: true,
        fieldMappingComplete: null,
      },
      routingRules: [
        {
          id: "rule_ray",
          campaignId: "camp_ray",
          campaignName: null,
          utmCampaign: null,
          active: true,
          deliveryEnabled: true,
        },
      ],
    },
    sources: {
      availability: "ready",
      items: [
        source({ id: "funnel_a", observedFunnelName: "First source" }),
        source({
          id: "funnel_b",
          observedFunnelName: "Second source",
          parentUrlKey: "quotes.example.com/second",
          providerFunnelId: null,
          associationStatus: "suggested",
          firstSeenAt: null,
          lastSeenAt: null,
        }),
      ],
    },
    setup: { availability: "ready", status: "draft", revision: 2, destinationChoice: "both" },
    sheetsDestination: {
      availability: "ready",
      destination: {
        spreadsheetId: "sheet_ray",
        spreadsheetTitle: "Ray Rodriguez Leads",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_ray",
        worksheetTitle: "Campaign",
        accessStatus: "verified",
        writeReadiness: "verified",
        revision: 3,
        sharingEmail: "ray@example.com",
        sharingPermission: "not_granted",
      },
    },
    googleConnection: {
      availability: "ready",
      email: "ops@example.com",
      connectionStatus: "connected",
      rootFolderTitle: "Client Folders",
    },
    clientFolder: {
      availability: "ready",
      title: "Ray Rodriguez",
      url: "https://drive.google.com/folders/ray",
      spreadsheets: [{ spreadsheetId: "sheet_ray", title: "Ray Rodriguez Leads", url: "https://docs.google.com/spreadsheets/d/sheet_ray" }],
      links: [
        {
          spreadsheetId: "sheet_old",
          title: "Old workbook",
          url: "https://docs.google.com/spreadsheets/d/sheet_old",
          supersededAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    },
    sheetsDispatch: { availability: "ready", campaignDispatchEnabled: false, agedDispatchEnabled: false },
    sourceProof: {
      availability: "ready",
      evidenceTruncated: false,
      sources: [],
      fieldMapVerified: true,
      writerReceiptVerified: false,
    },
    ...overrides,
  };
}

test("the summary shows stored sources and destinations and has no write controls", () => {
  render(<OnboardingDiscoveryPanel clientAccountId="ray_rodriguez" model={buildOnboardingDiscovery(input())} />);

  const view = screen.getByTestId("onboarding-discovery");
  assert.ok(screen.getByRole("heading", { name: "Records already stored" }));
  assert.ok(screen.getByText("First source"));
  assert.ok(screen.getByText("Second source"));
  assert.match(view.textContent ?? "", /Ray Rodriguez Leads/);
  assert.match(view.textContent ?? "", /Old workbook superseded/);
  assert.match(view.textContent ?? "", /not the current destination/);
  assert.match(view.textContent ?? "", /ray@example.com/);
  assert.match(view.textContent ?? "", /camp_ray/);
  assert.match(view.textContent ?? "", /Provider lead UUID/);
  assert.match(view.textContent ?? "", /Suggested, not associated/);
  assert.equal(screen.queryByRole("button"), null);
  assert.equal(screen.queryByRole("textbox"), null);
  assert.ok(screen.getByRole("link", { name: "Open advanced configuration" }));
  assert.match(view.textContent ?? "", /only reads/i);
  assert.match(view.textContent ?? "", /1 of 2 stored sources have a first lead time/);
  assert.match(view.textContent ?? "", /Controlled test recorded/);
  assert.match(view.textContent ?? "", /Field-value validation/);
  assert.match(view.textContent ?? "", /Stored delivery flag/);
  assert.match(view.textContent ?? "", /does not show that delivery ran/);
  assert.equal(view.textContent?.includes("Test delivery verified"), false);
  assert.equal(view.textContent?.includes("Field mapping verified"), false);
  assert.equal(view.textContent?.includes("Live delivery enabled"), false);
});

test("the folder listing can arrive after the stored destination", () => {
  render(
    <OnboardingDiscoveryPanel
      clientAccountId="ray_rodriguez"
      model={buildOnboardingDiscovery(
        input({
          clientFolder: { availability: "deferred", title: null, url: null, spreadsheets: [], links: [] },
        })
      )}
      folderRead={<p>Loading spreadsheets in the client folder…</p>}
    />
  );
  assert.ok(screen.getByText("Ray Rodriguez Leads"));
  assert.ok(screen.getByText("Loading spreadsheets in the client folder…"));
  assert.equal(screen.queryByText(/stored destination above is unchanged/), null);
});

test("empty and unavailable reads explain what is missing", () => {
  const empty = render(
    <OnboardingDiscoveryPanel
      clientAccountId="ray_rodriguez"
      model={buildOnboardingDiscovery(
        input({
          sources: { availability: "ready", items: [] },
          clientFolder: { availability: "ready", title: null, url: null, spreadsheets: [], links: [] },
          sheetsDestination: { availability: "ready", destination: null },
        })
      )}
    />
  );
  assert.ok(screen.getByText(/No source pages are stored/i));
  assert.ok(screen.getByText(/No client folder is associated/i));
  assert.ok(screen.getByText(/No Company Sheets destination is stored/i));
  empty.unmount();

  render(
    <OnboardingDiscoveryPanel
      clientAccountId="ray_rodriguez"
      model={buildOnboardingDiscovery(
        input({
          sources: { availability: "unavailable", items: [] },
          sheetsDestination: { availability: "unavailable", destination: null },
          clientFolder: { availability: "unavailable", title: null, url: null, spreadsheets: [], links: [] },
        })
      )}
    />
  );
  const unavailable = screen.getByTestId("onboarding-discovery");
  assert.match(unavailable.textContent ?? "", /Source records could not be loaded/);
  assert.match(unavailable.textContent ?? "", /not treated as unconfigured/);
});
