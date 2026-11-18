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
      section("environment", "Legacy approve-delivery / bulk live-canary", [
        {
          key: "env_allowlist_configured",
          label: "Legacy approve-delivery / bulk live-canary env allowlist configured",
          complete: false,
          detail: "SA360_DIRECT_DELIVERY_ALLOWED_* not set (legacy routes default to the demo pair only)",
        },
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

test("the environment section is labeled as a legacy allowlist and does not ask an ongoing client to edit it", () => {
  render(<ClientCutoverReadinessPanel report={report()} quickLinks={false} />);
  const caption = screen.getByTestId("legacy-allowlist-caption");
  assert.match(caption.textContent ?? "", /legacy approve-delivery and bulk live canary/);
  assert.match(caption.textContent ?? "", /Confirmed-source-association GHL delivery/);
  assert.match(caption.textContent ?? "", /Company Sheets campaign delivery do not use these lists/);
  assert.match(screen.getByText(/environment allowlist applies only to/).textContent ?? "", /legacy approve-delivery and bulk live canary/);

  cleanup();
  render(
    <ClientCutoverReadinessPanel
      quickLinks={false}
      report={report({
        clientAccountId: "ongoing_client",
        clientDisplayName: "Ongoing Client",
        overallStatus: "ready_for_live_review",
        sections: [
          section("ghl_destination", "GHL destination", [
            { key: "oauth_connected", label: "OAuth connected", complete: true },
          ], true),
          section("environment", "Legacy approve-delivery / bulk live-canary", [
            {
              key: "env_allowlist_configured",
              label: "Legacy approve-delivery / bulk live-canary env allowlist",
              complete: true,
              detail: "Not required for this client's confirmed-source-association GHL delivery. SA360_DIRECT_DELIVERY_ALLOWED_* is unset.",
            },
            {
              key: "destination_allowlisted",
              label: "Legacy approve-delivery / bulk live-canary client allowlist",
              complete: true,
              detail: "This client is absent from the legacy list. Do not add this client for confirmed-source-association GHL delivery.",
            },
          ], true),
        ],
        blockers: [],
        warnings: [
          "Legacy approve-delivery and bulk live-canary consult SA360_DIRECT_DELIVERY_ALLOWED_*. This client uses confirmed-source-association GHL delivery. Do not add this client to those lists for that delivery.",
        ],
        manualNextSteps: ["Run a live canary for one test lead from the Direct Delivery Demo page (manual operator step)."],
      })}
    />
  );
  assert.equal(screen.getByText("Ready for live review").textContent, "Ready for live review");
  assert.match(screen.getByText(/Do not add this client to those lists/).textContent ?? "", /confirmed-source-association GHL delivery/);
  assert.equal(screen.queryByText(/set SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS/i), null);
  assert.match(screen.getByText(/Not required for this client's confirmed-source-association GHL delivery/).textContent ?? "", /is unset/);
});

test("a legacy allowlist warning stays visible as a legacy approve-delivery requirement", () => {
  render(
    <ClientCutoverReadinessPanel
      quickLinks={false}
      report={report({
        overallStatus: "ready_for_shadow",
        warnings: [
          "Legacy approve-delivery and bulk live-canary: live delivery env allowlist is not configured (SA360_DIRECT_DELIVERY_ALLOWED_*). Confirmed-source-association GHL delivery and Company Sheets campaign delivery do not use these lists.",
        ],
        manualNextSteps: [
          "Legacy approve-delivery and bulk live canary only: set SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS and SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS at deploy time. Do not add a client to these lists to activate confirmed-source-association GHL delivery or Company Sheets campaign delivery.",
        ],
      })}
    />
  );
  assert.match(screen.getByText(/live delivery env allowlist is not configured/).textContent ?? "", /Legacy approve-delivery and bulk live-canary/);
  assert.match(
    screen.getByText(/set SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS/).textContent ?? "",
    /Do not add a client to these lists to activate confirmed-source-association GHL delivery or Company Sheets campaign delivery/
  );
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
