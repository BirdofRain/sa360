import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

import type { ClientCutoverReadinessReport, CutoverReadinessSection } from "@/lib/clients/cutover-readiness-types";

import { ClientCutoverReadinessPanel } from "./client-cutover-readiness-panel.tsx";

test.afterEach(() => cleanup());

function section(
  key: CutoverReadinessSection["key"],
  label: string,
  items: CutoverReadinessSection["items"],
  complete = false
): CutoverReadinessSection {
  return { key, label, complete, items };
}

function report(overrides: Partial<ClientCutoverReadinessReport> = {}): ClientCutoverReadinessReport {
  return {
    clientAccountId: "morgan",
    clientDisplayName: "Morgan",
    status: "active",
    generatedAt: "2026-11-12T22:00:00.000Z",
    overallStatus: "not_ready",
    sections: [
      section("client_account", "Client account", [
        { key: "client_exists", label: "Client account exists", complete: true, detail: "morgan" },
      ], true),
      section("ghl_destination", "GHL destination", [
        { key: "oauth_connected", label: "OAuth connected", complete: true, detail: "connected" },
      ], true),
      section("routing_rules", "Routing rules", [
        { key: "active_rule_exists", label: "At least one active routing rule", complete: false, detail: "0 active of 0 total" },
        { key: "rule_destination_set", label: "Active rules have a destination subaccount", complete: false, detail: "no active rules" },
        { key: "rule_master_source", label: "Master lead source mapped", complete: false, detail: "no master source" },
      ]),
      section("portal_access", "Portal access", [
        { key: "portal_enabled", label: "Portal access enabled", complete: false, detail: "not enabled (manual go-live step)" },
      ]),
      section("delivery_readiness", "Delivery readiness", [
        { key: "client_cutover_approved", label: "Client cutover approved (manual)", complete: false, detail: "no active rules" },
      ]),
      section("environment", "Environment", [
        { key: "env_allowlist_configured", label: "Live delivery env allowlist configured (manual deploy step)", complete: false },
      ]),
    ],
    blockers: ["No active routing rule maps a master source to this client."],
    warnings: ["Portal access is not enabled (manual go-live step)."],
    manualNextSteps: ["Create an active routing rule for this client."],
    ...overrides,
  };
}

test("Morgan with a configured GHL destination and zero routing rules keeps the checks separate", () => {
  render(<ClientCutoverReadinessPanel report={report()} quickLinks={false} />);
  assert.match(screen.getByRole("heading", { name: "Legacy / master-routed cutover readiness" }).textContent ?? "", /Legacy/);
  const destination = screen.getByTestId("ghl-destination-configuration-readiness");
  assert.match(destination.textContent ?? "", /OAuth connected/);
  assert.match(destination.textContent ?? "", /No GHL destination configuration blockers/);
  assert.equal(destination.textContent?.includes("No active routing rule"), false);
  const routing = screen.getByTestId("legacy-routing-applicability");
  assert.match(routing.textContent ?? "", /Unknown/);
  assert.match(routing.textContent ?? "", /not a GHL setup requirement/);
  assert.match(routing.textContent ?? "", /No active routing rule maps a master source to this client/);
  assert.match(screen.getByText(/Applicability to this client is unknown/).textContent ?? "", /not a GHL destination step/);
  assert.equal(screen.queryByText(/GHL setup requires a routing rule/), null);
});

test("a legacy master-source routing rule is labeled as applying to that delivery model", () => {
  render(
    <ClientCutoverReadinessPanel
      quickLinks={false}
      report={report({
        clientAccountId: "legacy_client",
        clientDisplayName: "Legacy Client",
        overallStatus: "ready_for_shadow",
        sections: [
          section("ghl_destination", "GHL destination", [
            { key: "client_linked", label: "Client linked to GHL location", complete: true, detail: "LOC_LEGACY" },
          ], true),
          section("routing_rules", "Routing rules", [
            { key: "active_rule_exists", label: "At least one active routing rule", complete: true, detail: "1 active of 1 total" },
            { key: "rule_destination_set", label: "Active rules have a destination subaccount", complete: true, detail: "1/1 rules have destinationSubaccountIdGhl" },
            { key: "rule_master_source", label: "Master lead source mapped", complete: true, detail: "lal_master_vet" },
          ], true),
        ],
        blockers: [],
        warnings: ["Rule rule_1: client cutover not approved (manual step)."],
        manualNextSteps: ["Review and approve cutover on the Delivery Readiness page (manual operator step)."],
      })}
    />
  );
  const routing = screen.getByTestId("legacy-routing-applicability");
  assert.match(routing.textContent ?? "", /Applies to legacy master-source routing/);
  assert.match(routing.textContent ?? "", /does not create a routing rule/);
  assert.equal(routing.textContent?.includes("No active routing rule"), false);
  assert.match(screen.getByText(/lal_master_vet/).textContent ?? "", /lal_master_vet/);
  assert.match(screen.getByText(/client cutover not approved/).textContent ?? "", /manual step/);
});

test("an unconfigured GHL destination stays in the destination section", () => {
  render(
    <ClientCutoverReadinessPanel
      quickLinks={false}
      report={report({
        clientAccountId: "unconfigured",
        sections: [
          section("ghl_destination", "GHL destination", [
            { key: "destination_configured", label: "GHL destination configured", complete: false, detail: "no GHL location linked" },
          ]),
          section("routing_rules", "Routing rules", [
            { key: "active_rule_exists", label: "At least one active routing rule", complete: false, detail: "0 active of 0 total" },
            { key: "rule_master_source", label: "Master lead source mapped", complete: false, detail: "no master source" },
          ]),
        ],
        blockers: [
          "GHL destination is not configured for this client.",
          "No active routing rule maps a master source to this client.",
        ],
      })}
    />
  );
  const destination = screen.getByTestId("ghl-destination-configuration-readiness");
  assert.match(destination.textContent ?? "", /GHL destination is not configured for this client/);
  assert.match(destination.textContent ?? "", /no GHL location linked/);
  const routing = screen.getByTestId("legacy-routing-applicability");
  assert.match(routing.textContent ?? "", /Unknown/);
  assert.equal(within(destination).queryByText(/No active routing rule/), null);
  assert.match(routing.textContent ?? "", /No active routing rule maps a master source/);
});
