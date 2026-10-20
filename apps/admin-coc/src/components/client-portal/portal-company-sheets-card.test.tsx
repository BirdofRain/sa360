import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { PortalCompanySheetsCard } from "./portal-company-sheets-card.tsx";
import type { PortalCompanySheetsDestination } from "@/lib/client-portal-api/company-sheets";

afterEach(() => cleanup());

const destination: PortalCompanySheetsDestination = {
  configured: true,
  clientAccountId: "acme",
  spreadsheetTitle: "Acme Leads",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet1",
  worksheetTitle: "Leads",
  accessStatus: "readable",
  writeReadiness: "not_verified",
  deliveryExecution: "disabled",
  liveDeliveryEnabled: false,
  sharing: {
    portalLinkGrantsGoogleAccess: false,
    clientGooglePermission: "not_granted",
    anyoneWithLink: false,
    public: false,
    missingRecipientPolicy: true,
    status: "missing_recipient",
  },
  connection: { status: "connected", connected: true, reconnectRequired: false },
  tabs: [
    {
      role: "campaign",
      setupState: "bound",
      setupReason: null,
      worksheetTitle: "Campaign Leads",
      schemaVersion: "company_sheets_campaign_v1",
      tabUrl: "https://docs.google.com/spreadsheets/d/sheet1/edit#gid=10",
      deliveryState: "configured",
    },
    {
      role: "aged",
      setupState: "missing",
      setupReason: "tab_missing",
      worksheetTitle: null,
      schemaVersion: null,
      tabUrl: null,
      deliveryState: "configured",
    },
  ],
  orderDelivery: { status: "not_started", automatedWritesEnabled: false },
};

describe("PortalCompanySheetsCard", () => {
  it("shows the configured link and says delivery has not started", () => {
    render(<PortalCompanySheetsCard destination={destination} context="account" />);
    const link = screen.getByRole("link", { name: "Acme Leads" });
    assert.equal(link.getAttribute("href"), destination.spreadsheetUrl);
    const campaign = screen.getByRole("link", { name: "Campaign Leads" });
    assert.equal(campaign.getAttribute("href"), "https://docs.google.com/spreadsheets/d/sheet1/edit#gid=10");
    assert.ok(screen.getByText(/Delivery configured/));
    assert.ok(screen.getByText(/Aged Orders/));
    assert.ok(screen.getByText(/not set up/));
    assert.ok(screen.getByText(/does not give your Google account access/));
  });

  it("does not invent an order delivery status when nothing is configured", () => {
    render(<PortalCompanySheetsCard destination={null} context="order" />);
    assert.ok(screen.getByText(/No automated Google Sheets delivery has been recorded/));
    assert.equal(screen.queryByRole("link"), null);
  });

  it("keeps order CSV semantics separate from the account spreadsheet", () => {
    render(<PortalCompanySheetsCard destination={destination} context="order" />);
    assert.ok(screen.getByText(/CSV download is unchanged/));
    assert.ok(screen.getByText(/current spreadsheet/));
    assert.equal(screen.queryByRole("link"), null);
  });

  it("renders recorded order evidence and ignores the account spreadsheet", () => {
    render(
      <PortalCompanySheetsCard
        destination={destination}
        context="order"
        orderEvidence={[
          {
            exportPackageId: "pkg_supplemental",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/snapshot-a",
            tabUrl: "https://docs.google.com/spreadsheets/d/snapshot-a/edit#gid=4",
            worksheetTitle: "Aged Orders",
            status: "succeeded",
            deliveryState: "succeeded",
          },
          {
            exportPackageId: "pkg_replacement",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/snapshot-b",
            tabUrl: "https://docs.google.com/spreadsheets/d/snapshot-b/edit#gid=4",
            worksheetTitle: "Aged Orders",
            status: "queued",
            deliveryState: "queued",
          },
        ]}
      />
    );
    const links = screen.getAllByRole("link", { name: "Spreadsheet for this order" });
    assert.deepEqual(
      links.map((link) => link.getAttribute("href")),
      [
        "https://docs.google.com/spreadsheets/d/snapshot-a/edit#gid=4",
        "https://docs.google.com/spreadsheets/d/snapshot-b/edit#gid=4",
      ]
    );
    assert.equal(links.some((link) => link.getAttribute("href") === destination.spreadsheetUrl), false);
    assert.ok(screen.getByText(/Automated Sheets status: succeeded/));
    assert.ok(screen.getByText(/does not grant Google access/));
  });

  it("does not show a link when order evidence cannot be loaded", () => {
    render(
      <PortalCompanySheetsCard
        destination={destination}
        context="order"
        error="Spreadsheet status for this order is unavailable"
      />
    );
    assert.equal(screen.queryByRole("link"), null);
    assert.ok(screen.getByRole("alert"));
  });
});
