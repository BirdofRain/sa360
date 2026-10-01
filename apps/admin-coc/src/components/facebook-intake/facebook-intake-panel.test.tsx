import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => undefined }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let FacebookIntakePanel: typeof import("./facebook-intake-panel.tsx").FacebookIntakePanel;

test.before(async () => {
  ({ FacebookIntakePanel } = await import("./facebook-intake-panel.tsx"));
});

test.afterEach(() => {
  cleanup();
});

test("Facebook intake panel submits page and form association without delivery copy", async () => {
  const calls: Array<Record<string, string>> = [];
  render(
    React.createElement(FacebookIntakePanel, {
      associations: [],
      loadError: null,
      associateAction: async (input) => {
        calls.push(input);
        return {
          ok: true as const,
          created: true,
          ownershipUnchanged: false,
          item: {
            id: "funnel_1",
            pageId: input.pageId,
            formId: input.formId,
            formName: input.formName ?? null,
            clientAccountId: input.clientAccountId,
            associationStatus: "confirmed" as const,
            providerFunnelId: `fbpage:${input.pageId}:fbform:${input.formId}`,
          },
        };
      },
      reevaluateAction: async () => {
        throw new Error("not used");
      },
    })
  );
  assert.ok(screen.getByText(/No Facebook form associations yet/));
  assert.ok(screen.getByText(/GHL location, snapshot, and custom-field setup are not capture/));
  fireEvent.change(screen.getByLabelText("Page ID"), { target: { value: "900000000000101" } });
  fireEvent.change(screen.getByLabelText("Form ID"), { target: { value: "900000000000201" } });
  fireEvent.change(screen.getByLabelText("Client account ID"), { target: { value: "synthetic_client" } });
  fireEvent.click(screen.getByRole("button", { name: "Save association" }));
  await waitFor(() => {
    assert.equal(calls.length, 1);
  });
  assert.equal(calls[0]?.pageId, "900000000000101");
  assert.equal(calls[0]?.formId, "900000000000201");
  assert.equal(calls[0]?.clientAccountId, "synthetic_client");
  assert.ok(await screen.findByText(/Existing leads were not rewritten/));
});
