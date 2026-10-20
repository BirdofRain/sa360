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
  orderDelivery: { status: "not_started", automatedWritesEnabled: false },
};

describe("PortalCompanySheetsCard", () => {
  it("shows the configured link and says delivery has not started", () => {
    render(<PortalCompanySheetsCard destination={destination} context="account" />);
    const link = screen.getByRole("link", { name: "Acme Leads" });
    assert.equal(link.getAttribute("href"), destination.spreadsheetUrl);
    assert.ok(screen.getByText(/not written to this spreadsheet yet/));
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
            worksheetTitle: "Release A",
            status: "succeeded",
          },
          {
            exportPackageId: "pkg_replacement",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/snapshot-b",
            worksheetTitle: "Release B",
            status: "queued",
          },
        ]}
      />
    );
    const links = screen.getAllByRole("link", { name: "Spreadsheet for this order" });
    assert.deepEqual(
      links.map((link) => link.getAttribute("href")),
      [
        "https://docs.google.com/spreadsheets/d/snapshot-a",
        "https://docs.google.com/spreadsheets/d/snapshot-b",
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
