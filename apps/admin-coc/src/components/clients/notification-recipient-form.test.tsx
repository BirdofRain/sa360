import assert from "node:assert/strict";
import module from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") return { useRouter: () => ({ refresh: () => undefined }) };
  return originalLoad.call(this, request, parent, isMain);
};

import type { RecipientSnapshot } from "@/lib/notification-setup/model";

type FormModule = typeof import("./notification-recipient-form.tsx");
let NotificationRecipientForm: FormModule["NotificationRecipientForm"];
type RecipientFormActions = FormModule["RecipientFormActions"];

test.before(async () => {
  ({ NotificationRecipientForm } = await import("./notification-recipient-form.tsx"));
});

const empty: RecipientSnapshot = {
  clientAccountId: "alex_gross",
  recipientEmail: null,
  recipientVerified: false,
  recipientEmailVerifiedAt: null,
  enabled: false,
  revision: 0,
};

function saved(email: string, revision: number, enabled = false): RecipientSnapshot {
  return {
    clientAccountId: "alex_gross",
    recipientEmail: email,
    recipientVerified: true,
    recipientEmailVerifiedAt: "2026-11-09T18:04:00.000Z",
    enabled,
    revision,
  };
}

test.afterEach(() => {
  cleanup();
});

test("the form does not invent a recipient and rejects more than one address", () => {
  const calls: unknown[] = [];
  render(
    <NotificationRecipientForm
      clientAccountId="alex_gross"
      recipient={empty}
      actions={{
        save: async (input) => {
          calls.push(input);
          throw new Error("save should not run");
        },
        reload: async () => ({ ok: true, recipient: empty }),
      }}
    />
  );
  const input = screen.getByLabelText("Email address") as HTMLInputElement;
  assert.equal(input.value, "");
  assert.match(screen.getByText("None saved").textContent ?? "", /None saved/);
  assert.match(screen.getByText(/turns this notification off/).textContent ?? "", /Team Workspace/);
  assert.equal(document.body.textContent?.includes("portal"), true);
  assert.equal(document.body.textContent?.includes("@"), false);

  fireEvent.change(input, { target: { value: "Alex <owner@example.com>" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  assert.equal(calls.length, 0);
  assert.match(screen.getByRole("status").textContent ?? "", /one email address/);

  fireEvent.change(input, { target: { value: "owner@example.com, other@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  assert.equal(calls.length, 0);
});

test("saving waits for confirmation and a conflict reloads the saved address", async () => {
  const calls: { requestId: string; expectedRevision: number; recipientEmail: string }[] = [];
  let attempt = 0;
  const actions: RecipientFormActions = {
    save: (input) => {
      calls.push({
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        recipientEmail: input.recipientEmail,
      });
      attempt += 1;
      if (attempt === 1) {
        return new Promise(() => undefined);
      }
      return Promise.resolve({
        ok: false as const,
        error: "revision_conflict" as const,
        recipient: saved("current@example.com", 4, true),
      });
    },
    reload: async () => ({ ok: true, recipient: saved("current@example.com", 4, true) }),
  };
  render(<NotificationRecipientForm clientAccountId="alex_gross" recipient={empty} actions={actions} />);
  const input = screen.getByLabelText("Email address") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "  Owner@Example.com " } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.recipientEmail, "owner@example.com");
  assert.equal(calls[0]?.expectedRevision, 0);
  assert.equal(screen.getByRole("status").textContent, "Saving…");
  assert.equal(screen.getByText("None saved").textContent, "None saved");
  assert.equal(screen.queryByText(/^Saved/), null);
});

test("a confirmed save shows the verified address and a stale save does not", async () => {
  let mode: "ok" | "conflict" | "retry" = "ok";
  const calls: { requestId: string; expectedRevision: number; recipientEmail: string }[] = [];
  const actions: RecipientFormActions = {
    save: async (input) => {
      calls.push({
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        recipientEmail: input.recipientEmail,
      });
      if (mode === "conflict") {
        return { ok: false, error: "revision_conflict", recipient: saved("current@example.com", 4, true) };
      }
      if (mode === "retry") {
        if (calls.length === 1) return { ok: false, error: "request_failed", recipient: null };
        return { ok: true, recipient: saved("owner@example.com", 1), replayed: true, refreshed: true };
      }
      return { ok: true, recipient: saved("owner@example.com", 1), replayed: false, refreshed: true };
    },
    reload: async () => ({ ok: true, recipient: saved("current@example.com", 4, true) }),
  };
  const view = render(<NotificationRecipientForm clientAccountId="alex_gross" recipient={empty} actions={actions} />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "Owner@Example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  assert.match((await screen.findByRole("status")).textContent ?? "", /the notification preference is off until it is turned on again/);
  assert.match((await screen.findByRole("status")).textContent ?? "", /Production delivery notifications stay unchanged/);
  assert.equal(screen.getAllByText("owner@example.com").length >= 1, true);
  assert.equal((screen.getByLabelText("Email address") as HTMLInputElement).value, "owner@example.com");

  mode = "conflict";
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "next@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  const conflict = await screen.findByText(/changed somewhere else/);
  assert.equal(conflict.textContent?.includes("Saved"), false);
  assert.equal((screen.getByLabelText("Email address") as HTMLInputElement).value, "current@example.com");
  assert.equal(screen.getByText("On").textContent, "On");

  view.rerender(
    <NotificationRecipientForm clientAccountId="aaron_lee" recipient={{ ...empty, clientAccountId: "aaron_lee" }} actions={actions} />
  );
  mode = "retry";
  calls.length = 0;
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "retry@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await screen.findByText(/already stored/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.requestId, calls[1]?.requestId);
  assert.equal(calls[0]?.expectedRevision, 0);
});

test("a rejected recipient save stays recoverable and keeps the request id", async () => {
  const calls: string[] = [];
  let attempt = 0;
  const actions: RecipientFormActions = {
    save: async (input) => {
      calls.push(input.requestId);
      attempt += 1;
      if (attempt === 1) throw new Error("gateway secret-token");
      return { ok: true, recipient: saved("owner@example.com", 1, true), replayed: true, refreshed: true };
    },
    reload: async () => {
      throw new Error("reload should wait");
    },
  };
  render(<NotificationRecipientForm clientAccountId="alex_gross" recipient={empty} actions={actions} />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "Owner@Example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  const status = await screen.findByRole("status");
  assert.equal(status.getAttribute("data-state"), "error");
  assert.match(status.textContent ?? "", /did not finish/);
  assert.equal(status.textContent?.includes("secret-token"), false);
  assert.equal(status.textContent?.includes("Saving"), false);
  assert.equal(screen.getByText("None saved").textContent, "None saved");
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  const savedText = await screen.findByText(/preference is still on/);
  assert.match(savedText.textContent ?? "", /Production delivery notifications stay unchanged/);
  assert.match(savedText.textContent ?? "", /does not send email/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test("a rejected recipient reload leaves the loading state and can be tried again", async () => {
  let reloads = 0;
  const actions: RecipientFormActions = {
    save: async () => {
      throw new Error("save transport failed");
    },
    reload: async () => {
      reloads += 1;
      if (reloads === 1) throw new Error("read timeout internal-detail");
      return { ok: true, recipient: saved("owner@example.com", 2) };
    },
  };
  render(<NotificationRecipientForm clientAccountId="alex_gross" recipient={empty} actions={actions} />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "owner@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipient" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reload saved recipient" }));
  await waitFor(() => {
    assert.equal(reloads, 1);
    assert.equal(screen.getByRole("status").getAttribute("data-state"), "error");
  });
  const failed = screen.getByRole("status");
  assert.equal(failed.getAttribute("data-state"), "error");
  assert.match(failed.textContent ?? "", /did not finish/);
  assert.equal(failed.textContent?.includes("internal-detail"), false);
  assert.equal(failed.textContent?.includes("Loading"), false);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved recipient" }));
  const shown = await screen.findByText("Showing the saved recipient.");
  assert.equal(shown.getAttribute("data-state"), "idle");
  assert.equal(screen.getAllByText("owner@example.com").length >= 1, true);
  assert.equal(reloads, 2);
});

test("recipient setup stays off the team workspace and the observer allowlist", () => {
  const page = readFileSync(new URL("../../app/(dashboard)/clients/[clientAccountId]/notification-recipient/page.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./notification-recipient-form.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../team-workspace/notification-choice.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("portalLoginEmail"), false);
  assert.equal(form.includes("portalLoginEmail"), false);
  assert.equal(workspace.includes("recipientEmail"), false);
  assert.equal(workspace.includes("portalLoginEmail"), false);
});
