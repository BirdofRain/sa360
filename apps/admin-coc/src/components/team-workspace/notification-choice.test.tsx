import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
const refreshCalls: string[] = [];
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => refreshCalls.push("refresh") }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import type { PreferenceSnapshot } from "@/lib/notification-setup/model";
import type { TeamWorkspaceNotificationChoice } from "@/lib/team-workspace/types";

type ChoiceModule = typeof import("./notification-choice.tsx");
let DeliveryNotificationChoice: ChoiceModule["DeliveryNotificationChoice"];
type NotificationChoiceActions = ChoiceModule["NotificationChoiceActions"];

test.before(async () => {
  ({ DeliveryNotificationChoice } = await import("./notification-choice.tsx"));
});

const off: TeamWorkspaceNotificationChoice = {
  enabled: false,
  canEnable: false,
  blockedReason: "recipient_not_verified",
  recipientVerified: false,
  revision: 0,
  readable: true,
};

const ready: TeamWorkspaceNotificationChoice = {
  enabled: false,
  canEnable: true,
  blockedReason: null,
  recipientVerified: true,
  revision: 2,
  readable: true,
};

function preference(enabled: boolean, revision: number): PreferenceSnapshot {
  return {
    enabled,
    canEnable: true,
    blockedReason: null,
    recipientVerified: true,
    revision,
  };
}

test.afterEach(() => {
  cleanup();
  refreshCalls.length = 0;
});

test("an unverified recipient stays off and does not save", () => {
  const calls: unknown[] = [];
  render(
    <DeliveryNotificationChoice
      clientAccountId="alex_gross"
      preference={off}
      actions={{
        save: async (input) => {
          calls.push(input);
          throw new Error("save should not run");
        },
        reload: async () => {
          throw new Error("reload should not run");
        },
      }}
    />
  );
  const choice = screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" });
  assert.equal((choice as HTMLInputElement).disabled, true);
  assert.equal((choice as HTMLInputElement).checked, false);
  assert.match(screen.getByText(/configured in Admin C\.O\.C\./).textContent ?? "", /before this can be turned on/);
  fireEvent.click(choice);
  assert.equal(calls.length, 0);
  assert.equal(screen.getByRole("link", { name: "Open recipient setup in Admin C.O.C." }).getAttribute("href"), "/clients/alex_gross/notification-recipient");
  assert.equal(document.body.textContent?.includes("@"), false);
});

test("a verified recipient can be turned on only after the save is confirmed", async () => {
  const calls: { requestId: string; expectedRevision: number; enabled: boolean }[] = [];
  let release: (value: Awaited<ReturnType<NotificationChoiceActions["save"]>>) => void = () => undefined;
  const actions: NotificationChoiceActions = {
    save: (input) => {
      calls.push({ requestId: input.requestId, expectedRevision: input.expectedRevision, enabled: input.enabled });
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    reload: async () => ({ ok: true, preference: preference(true, 3) }),
  };
  render(<DeliveryNotificationChoice clientAccountId="alex_gross" preference={ready} actions={actions} />);
  const choice = screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" });
  fireEvent.click(choice);
  fireEvent.click(choice);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.enabled, true);
  assert.equal(calls[0]?.expectedRevision, 2);
  assert.match(calls[0]?.requestId ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal((choice as HTMLInputElement).checked, false);
  assert.equal(screen.getByRole("status").textContent, "Saving…");
  assert.equal(screen.getByRole("status").textContent?.includes("Saved"), false);

  release({ ok: true, preference: preference(true, 3), replayed: false, refreshed: true });
  const saved = await screen.findByText(/Saved\. This client will be notified/);
  assert.match(saved.textContent ?? "", /successfully delivered/);
  assert.equal((screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }) as HTMLInputElement).checked, true);
  assert.equal(refreshCalls.length, 1);
});

test("a conflict keeps the previous choice and shows the reloaded revision", async () => {
  const calls: { requestId: string; expectedRevision: number; enabled: boolean }[] = [];
  const actions: NotificationChoiceActions = {
    save: async (input) => {
      calls.push({ requestId: input.requestId, expectedRevision: input.expectedRevision, enabled: input.enabled });
      return {
        ok: false,
        error: "revision_conflict",
        preference: preference(false, 5),
      };
    },
    reload: async () => ({ ok: true, preference: preference(false, 5) }),
  };
  render(<DeliveryNotificationChoice clientAccountId="alex_gross" preference={{ ...ready, enabled: false }} actions={actions} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }));
  const status = await screen.findByRole("status");
  assert.match(status.textContent ?? "", /changed somewhere else/);
  assert.equal(status.textContent?.includes("Saved"), false);
  assert.equal((screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }) as HTMLInputElement).checked, false);

  fireEvent.click(screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }));
  await waitFor(() => {
    assert.equal(calls.length, 2);
  });
  assert.notEqual(calls[1]?.requestId, calls[0]?.requestId);
  assert.equal(calls[1]?.expectedRevision, 5);
  assert.equal(screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }).getAttribute("aria-checked") ?? "", "");
  assert.equal(
    (screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }) as HTMLInputElement).checked,
    false
  );
  assert.match(screen.getByRole("status").textContent ?? "", /changed somewhere else/);
});

test("a failed save can be retried with the same request id", async () => {
  const calls: { requestId: string; enabled: boolean }[] = [];
  let attempt = 0;
  const actions: NotificationChoiceActions = {
    save: async (input) => {
      calls.push({ requestId: input.requestId, enabled: input.enabled });
      attempt += 1;
      if (attempt === 1) return { ok: false, error: "request_failed", preference: null };
      return { ok: true, preference: preference(true, 3), replayed: true, refreshed: true };
    },
    reload: async () => ({ ok: false, error: "request_failed" }),
  };
  render(<DeliveryNotificationChoice clientAccountId="alex_gross" preference={ready} actions={actions} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }));
  const retry = await screen.findByRole("button", { name: "Retry save" });
  assert.match(screen.getByRole("status").textContent ?? "", /did not finish/);
  assert.equal((screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }) as HTMLInputElement).checked, false);
  fireEvent.click(retry);
  const saved = await screen.findByText(/already stored/);
  assert.match(saved.textContent ?? "", /Saved/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.requestId, calls[1]?.requestId);
  assert.equal(calls[1]?.enabled, true);
});

test("turning the saved choice off waits for confirmation", async () => {
  const calls: boolean[] = [];
  const actions: NotificationChoiceActions = {
    save: async (input) => {
      calls.push(input.enabled);
      return { ok: true, preference: preference(false, 4), replayed: false, refreshed: true };
    },
    reload: async () => ({ ok: true, preference: preference(false, 4) }),
  };
  render(
    <DeliveryNotificationChoice
      clientAccountId="alex_gross"
      preference={{ ...ready, enabled: true, revision: 3 }}
      actions={actions}
    />
  );
  const choice = screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" });
  assert.equal((choice as HTMLInputElement).checked, true);
  fireEvent.click(choice);
  const saved = await screen.findByText(/will not be notified/);
  assert.match(saved.textContent ?? "", /Saved/);
  assert.deepEqual(calls, [false]);
  assert.equal((screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" }) as HTMLInputElement).checked, false);
});
