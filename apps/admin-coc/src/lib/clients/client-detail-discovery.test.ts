import assert from "node:assert/strict";
import test from "node:test";

import { clientDetailDiscoveryInput, type ClientDetailDiscoveryInput } from "./client-detail-discovery.ts";
import { buildOnboardingDiscovery } from "./onboarding-discovery.ts";
import type { ClientAccountDetail, ClientSetup } from "./types.ts";

function client(): ClientAccountDetail {
  return {
    clientAccountId: "client_a",
    clientDisplayName: "Client A",
    status: "onboarding",
    portalEnabled: false,
    portalDisplayName: null,
    portalLoginEmail: null,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ghlDestination: null,
    routingRules: [],
    destinationReadiness: null,
    activeRoutingRuleCount: 0,
  };
}

function setup(data: ClientSetup["data"] = {}): ClientSetup {
  return {
    status: "draft",
    data,
    revision: 1,
    repairRequired: false,
    missingRequiredFields: [],
    submittedAt: null,
    reviewedAt: null,
    updatedAt: null,
    operationalEffects: false,
  };
}

function base(overrides: Partial<ClientDetailDiscoveryInput> = {}): ClientDetailDiscoveryInput {
  return {
    client: client(),
    sources: { data: { items: [] }, error: null },
    setupEnabled: true,
    setup: { data: { item: setup() }, error: null },
    sheetsDestination: { ok: true, data: { destination: null } },
    googleConnection: { ok: false, error: "destination_disabled", status: 404 },
    sheetsDispatch: { ok: false, error: "destination_disabled", status: 404 },
    onboardingSummary: { ok: false, error: "request_failed", status: 503 },
    ...overrides,
  };
}

test("a failed sheets or source read is unavailable rather than an empty record", () => {
  const failed = clientDetailDiscoveryInput(
    base({
      sources: { data: null, error: "Admin API error (503): unavailable" },
      sheetsDestination: { ok: false, error: "destination_disabled", status: 404 },
      googleConnection: null,
    })
  );
  assert.equal(failed.sources.availability, "unavailable");
  assert.equal(failed.sheetsDestination.availability, "unavailable");
  assert.equal(failed.sheetsDestination.destination, null);
  assert.equal(failed.googleConnection.availability, "unavailable");
  assert.equal(failed.sourceProof.availability, "unavailable");

  const empty = clientDetailDiscoveryInput(
    base({
      sheetsDestination: { ok: true, data: { destination: null } },
      onboardingSummary: { ok: false, error: "onboarding_read_disabled", status: 404 },
    })
  );
  assert.equal(empty.sheetsDestination.availability, "ready");
  assert.equal(empty.sheetsDestination.destination, null);
  assert.equal(empty.sourceProof.availability, "disabled");
});

test("an operator checkbox is not reported as verified technical readiness", () => {
  const model = buildOnboardingDiscovery(
    clientDetailDiscoveryInput(
      base({
        setup: {
          data: {
            item: setup({ webhookConfigured: true, sourceTestSubmitted: true, destinationChoice: "ghl" }),
          },
          error: null,
        },
      })
    )
  );
  const permissions = model.checks.find((item) => item.id === "permissions_verified");
  const receipt = model.checks.find((item) => item.id === "delivery_receipt");
  assert.equal(permissions?.state, "no");
  assert.equal(permissions?.statusLabel, "Not verified");
  assert.match(receipt?.detail ?? "", /checkbox or review mark is not a receipt/);
  assert.equal(model.checks.some((item) => item.statusLabel === "Verified"), false);
});
