import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const createCalls: Array<Record<string, unknown>> = [];
const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return { useRouter: () => ({ push: () => undefined, refresh: () => undefined }) };
  }
  if (request === "@/app/actions/clients") {
    return {
      createClientAction: async (body: Record<string, unknown>) => {
        createCalls.push(body);
        return { ok: true, item: { clientAccountId: body.clientAccountId } };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let ClientCreateForm: typeof import("./client-create-form.tsx").ClientCreateForm;

test.before(async () => {
  ({ ClientCreateForm } = await import("./client-create-form.tsx"));
});

test.afterEach(() => {
  cleanup();
  createCalls.length = 0;
});

test("one-character suggestion blocks creation until a valid manual ID replaces it", async () => {
  render(<ClientCreateForm />);

  fireEvent.change(screen.getByLabelText("Client full name / display name"), {
    target: { value: "A" },
  });

  const idInput = screen.getByLabelText("Client account ID") as HTMLInputElement;
  const createButton = screen.getByRole("button", { name: "Create client" });
  assert.equal(idInput.value, "a");
  assert.equal(idInput.minLength, 2);
  assert.equal(idInput.getAttribute("aria-invalid"), "true");
  assert.equal((createButton as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("Enter an account ID with at least 2 characters."));

  fireEvent.change(idInput, { target: { value: "agent_a" } });
  assert.equal(idInput.value, "agent_a");
  assert.equal(idInput.getAttribute("aria-invalid"), "false");
  assert.equal((createButton as HTMLButtonElement).disabled, false);

  fireEvent.click(createButton);
  await waitFor(() => assert.equal(createCalls.length, 1));
  assert.equal(createCalls[0]?.clientAccountId, "agent_a");
  assert.equal(createCalls[0]?.clientDisplayName, "A");
});

test("new client product picker stays on the current catalog", () => {
  render(<ClientCreateForm />);
  const products = screen.getByLabelText("Primary products");
  const productField = products.parentElement!.parentElement!;
  fireEvent.change(products, { target: { value: "final_expense" } });
  fireEvent.click(within(productField).getByRole("button", { name: "Add" }));
  assert.ok(screen.getByText("Choose a value from the catalog."));
  assert.equal(screen.queryByRole("button", { name: "Remove final_expense" }), null);

  fireEvent.change(products, { target: { value: "Life" } });
  fireEvent.click(within(productField).getByRole("option", { name: "Life Insurance" }));
  assert.ok(screen.getByRole("button", { name: "Remove Life Insurance" }));
  assert.equal(screen.queryByRole("button", { name: "Remove final_expense" }), null);
});
