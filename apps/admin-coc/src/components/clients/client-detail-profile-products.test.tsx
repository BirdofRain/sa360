import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type { ClientAccountDetail } from "@/lib/clients/types";

const patches: Array<Record<string, unknown>> = [];

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return { useRouter: () => ({ push: () => undefined, refresh: () => undefined }) };
  }
  if (request === "@/app/actions/clients") {
    return {
      patchClientAction: async (_id: string, body: Record<string, unknown>) => {
        patches.push(body);
        return {
          ok: true,
          item: client({
            clientDisplayName: String(body.clientDisplayName ?? "Northshore Mutual"),
            primaryNicheKeys: body.primaryNicheKeys as string[],
            primaryProductTypes: body.primaryProductTypes as string[],
            notes: (body.notes as string | null) ?? null,
          }),
        };
      },
    };
  }
  if (request === "@/app/actions/ghl-connections") {
    return { startGhlOAuthConnectAction: async () => ({ ok: false, error: "not used" }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function client(overrides: Partial<ClientAccountDetail> = {}): ClientAccountDetail {
  return {
    clientAccountId: "northshore_mutual",
    clientDisplayName: "Northshore Mutual",
    status: "onboarding",
    portalEnabled: false,
    portalDisplayName: null,
    portalLoginEmail: null,
    primaryNicheKeys: ["VET", "MTG"],
    primaryProductTypes: ["final_expense", "life_insurance"],
    notes: "Keep the existing book",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ghlDestination: null,
    routingRules: [],
    destinationReadiness: null,
    activeRoutingRuleCount: 0,
    ...overrides,
  };
}

let ClientDetailPanel: typeof import("./client-detail-panel.tsx").ClientDetailPanel;

test.before(async () => {
  ({ ClientDetailPanel } = await import("./client-detail-panel.tsx"));
});

test.afterEach(() => {
  cleanup();
  patches.length = 0;
});

test("command center edit shows saved legacy products and keeps them on an unrelated save", async () => {
  render(<ClientDetailPanel initialClient={client()} />);

  assert.ok(screen.getByRole("button", { name: "Remove final_expense" }));
  assert.ok(screen.getByRole("button", { name: "Remove Life Insurance" }));
  assert.ok(screen.getByRole("button", { name: "Remove VETERAN" }));
  assert.ok(screen.getByRole("button", { name: "Remove MORTGAGE" }));
  assert.equal(screen.queryByRole("button", { name: "Remove Term life" }), null);

  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Northshore Benefits" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => {
    assert.equal(patches.length, 1);
    assert.equal((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled, false);
  });
  assert.equal(patches[0]?.clientDisplayName, "Northshore Benefits");
  assert.deepEqual(patches[0]?.primaryProductTypes, ["final_expense", "life_insurance"]);
  assert.deepEqual(patches[0]?.primaryNicheKeys, ["VET", "MTG"]);

  fireEvent.click(screen.getByRole("button", { name: "Remove final_expense" }));
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => assert.equal(patches.length, 2));
  assert.deepEqual(patches[1]?.primaryProductTypes, ["life_insurance"]);
  assert.equal(screen.queryByRole("button", { name: "Remove final_expense" }), null);
});
