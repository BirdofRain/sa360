import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { ClientAccountDetail, ClientSetup } from "@/lib/clients/types";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "@/app/actions/clients") {
    return { saveClientSetupAction: async () => ({ ok: false, error: "not called" }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let ClientSetupPanel: typeof import("./client-setup-panel.tsx").ClientSetupPanel;

test.before(async () => {
  ({ ClientSetupPanel } = await import("./client-setup-panel.tsx"));
});

test.afterEach(cleanup);

const client: ClientAccountDetail = {
  clientAccountId: "repair_client",
  clientDisplayName: "Repair Client",
  status: "onboarding",
  portalEnabled: false,
  portalDisplayName: null,
  portalLoginEmail: null,
  primaryNicheKeys: ["VET"],
  primaryProductTypes: ["final_expense"],
  notes: null,
  createdAt: "2026-09-30T12:00:00.000Z",
  updatedAt: "2026-09-30T12:00:00.000Z",
  ghlDestination: null,
  routingRules: [],
  destinationReadiness: null,
  activeRoutingRuleCount: 0,
};

const repairRequiredSetup: ClientSetup = {
  status: "draft",
  data: {},
  revision: 1,
  repairRequired: true,
  missingRequiredFields: [],
  submittedAt: null,
  reviewedAt: null,
  updatedAt: "2026-09-30T12:00:00.000Z",
  operationalEffects: false,
};

test("repair-required review state directs recovery and never claims completion", () => {
  render(<ClientSetupPanel client={client} initialSetup={repairRequiredSetup} />);

  fireEvent.click(screen.getByRole("tab", { name: "Checklist & review" }));

  assert.ok(
    screen.getByText(
      "Recover the unreadable setup document before checking submission requirements. Use the explicit recovery action above."
    )
  );
  assert.equal(
    screen.queryByText("✓ Required submission information is complete."),
    null
  );
  assert.equal(
    (screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement)
      .disabled,
    true
  );
});
