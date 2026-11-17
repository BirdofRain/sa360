import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import {
  ClientDetailLayout,
  ClientDiagnosticsLoading,
  ClientSetupLoading,
  StoredRecordsSection,
} from "./client-detail-layout.tsx";

test.afterEach(cleanup);

test("client setup renders above collapsed records, with advanced tools still reachable", () => {
  render(
    <ClientDetailLayout
      clientAccountId="client_a"
      clientDisplayName="Client A"
      statusLabel="Onboarding"
      setupEnabled
      setup={<p>Setup form</p>}
      diagnostics={
        <StoredRecordsSection>
          <p>Verbose source and destination diagnostics</p>
        </StoredRecordsSection>
      }
      advancedSources={<p>Source association</p>}
      advancedClient={<p>Client record editor</p>}
    />
  );

  const setup = screen.getByTestId("client-setup-region");
  const records = screen.getByTestId("stored-records");
  const advanced = screen.getByTestId("advanced-configuration");
  assert.equal(
    setup.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  assert.equal(
    records.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  assert.equal(records.hasAttribute("open"), false);
  assert.equal(advanced.hasAttribute("open"), false);
  assert.equal(screen.getByRole("heading", { name: "Client A" }).textContent, "Client A");
  assert.ok(screen.getByRole("link", { name: "Channel Profile settings" }));
  assert.ok(screen.getByRole("link", { name: "GHL destination configuration" }));
  assert.ok(screen.getByRole("link", { name: "Company Google Sheets" }));
  assert.ok(screen.getByRole("link", { name: "Delivery notification recipient" }));
  assert.ok(screen.getByRole("link", { name: "Setup & Delivery →" }));
  assert.ok(screen.getByText("Source association"));
  assert.ok(screen.getByText("Client record editor"));
});

test("advanced configuration stays open when native setup is disabled", () => {
  render(
    <ClientDetailLayout
      clientAccountId="client_a"
      clientDisplayName="Client A"
      statusLabel="Active"
      setupEnabled={false}
      setup={<p>Setup disabled</p>}
      diagnostics={<ClientDiagnosticsLoading />}
      advancedSources={<ClientSetupLoading />}
      advancedClient={<p>Editor</p>}
    />
  );
  assert.equal(screen.getByTestId("advanced-configuration").hasAttribute("open"), true);
  assert.ok(screen.getByText("Loading stored records…"));
});
