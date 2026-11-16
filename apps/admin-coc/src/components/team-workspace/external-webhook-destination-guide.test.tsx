import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { ExternalWebhookBridgeResult } from "@/lib/team-workspace/external-webhook-bridge";

const calls: string[] = [];
const saveIds: string[] = [];
const activateIds: string[] = [];
let readGate: Promise<void> = Promise.resolve();
let readResult: ExternalWebhookBridgeResult = disabled();
let preflightResult: ExternalWebhookBridgeResult = disabled();
let saveResult: ExternalWebhookBridgeResult = disabled();
let activateResult: ExternalWebhookBridgeResult = denied();
let saveThrows = false;

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/app/actions/external-webhook-config") {
    return {
      readExternalWebhookDestinationAction: async () => {
        calls.push("read");
        await readGate;
        return readResult;
      },
      preflightExternalWebhookDestinationAction: async () => {
        calls.push("preflight");
        return preflightResult;
      },
      saveExternalWebhookDestinationAction: async (input: { requestId: string }) => {
        calls.push("save");
        saveIds.push(input.requestId);
        if (saveThrows) throw new Error("socket hang up");
        return saveResult;
      },
      activateExternalWebhookDestinationAction: async (input: { requestId: string }) => {
        calls.push("activate");
        activateIds.push(input.requestId);
        return activateResult;
      },
      deactivateExternalWebhookDestinationAction: async (input: { requestId: string }) => {
        calls.push("deactivate");
        activateIds.push(input.requestId);
        return activateResult;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Guide: typeof import("./external-webhook-destination-guide.tsx").ExternalWebhookDestinationGuide;

test.before(async () => {
  ({ ExternalWebhookDestinationGuide: Guide } = await import("./external-webhook-destination-guide.tsx"));
});

test.afterEach(() => {
  cleanup();
  calls.length = 0;
  saveIds.length = 0;
  activateIds.length = 0;
  readGate = Promise.resolve();
  saveThrows = false;
  readResult = disabled();
  preflightResult = disabled();
  saveResult = disabled();
  activateResult = denied();
});

test("the guide does not store or display a saved URL or signing secret", () => {
  const source = readFileSync(new URL("./external-webhook-destination-guide.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("ADMIN_API_KEY"), false);
  assert.equal(source.includes("searchParams"), false);
});

test("a missing destination offers a choice and does not save", async () => {
  readResult = emptyStatus();
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  assert.equal((await screen.findByText("Not configured")).textContent, "Not configured");
  fireEvent.click(screen.getByRole("radio", { name: "Make or custom HTTPS webhook" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  assert.equal(webhookUrl().value, "");
  assert.equal(screen.getByRole("radio", { name: "HMAC signature" }).getAttribute("type"), "radio");
  assert.equal(calls.includes("save"), false);
  assert.equal(calls.includes("activate"), false);
});

test("a read-only session cannot check or activate", async () => {
  readResult = savedStatus({ enabled: false });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: false, canActivate: false }} />);
  assert.equal(await screen.findByText("Configured, disabled"), await screen.findByText("Configured, disabled"));
  assert.equal(screen.queryByRole("button", { name: "Replace saved URL" }), null);
  assert.equal(screen.queryByRole("button", { name: "Review activation" }), null);
  assert.equal(screen.queryByRole("button", { name: "Check this endpoint" }), null);
  assert.equal(calls.includes("preflight"), false);
});

test("a manager can preflight and save disabled without activation", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveResult = savedStatusResult({ enabled: false });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("radio", { name: "Make or custom HTTPS webhook" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/lead/secret-path" } });
  fireEvent.click(screen.getByRole("radio", { name: "HMAC signature" }));
  fireEvent.change(signingSecret(), { target: { value: "super-secret-value" } });
  assert.equal((webhookUrl() as HTMLInputElement).value.includes("secret-path"), true);
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  assert.equal(await screen.findByText(/This check does not send a lead/), await screen.findByText(/This check does not send a lead/));
  fireEvent.click(screen.getByRole("button", { name: "Save disabled configuration" }));
  assert.equal((await screen.findByRole("status")).textContent, "Configuration saved. Lead delivery is OFF.");
  assert.equal(document.body.textContent?.includes("secret-path"), false);
  assert.equal(document.body.textContent?.includes("super-secret-value"), false);
  assert.equal(screen.queryByRole("button", { name: "Review activation" }), null);
  assert.equal(calls.filter((call) => call === "save").length, 1);
  assert.equal(calls.includes("activate"), false);
});

test("an administrator activates only after confirmation and a refusal does not change the row", async () => {
  readResult = savedStatus({ enabled: false, hostname: "hooks.example.com" });
  activateResult = savedStatusResult({ enabled: true, hostname: "hooks.example.com" });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review activation" }));
  assert.match(document.body.textContent ?? "", /global webhook delivery feature is not changed/i);
  const enable = screen.getByRole("button", { name: "Enable this destination" });
  fireEvent.click(enable);
  assert.equal(calls.includes("activate"), false);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(enable);
  assert.equal(await screen.findByText(/global delivery switch is separate/), await screen.findByText(/global delivery switch is separate/));
  assert.equal(calls.filter((call) => call === "activate").length, 1);
  activateResult = denied();
  fireEvent.click(screen.getByRole("button", { name: "Review turning this off" }));
  if (!(screen.getByRole("checkbox") as HTMLInputElement).checked) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Turn this destination off" }));
  assert.equal(await screen.findByText(/cannot change the external webhook/), await screen.findByText(/cannot change the external webhook/));
});

test("a revision conflict stops the save and reload does not restore a secret", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveResult = failure("revision_conflict", true);
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  assert.equal(await screen.findByText(/Reload it before trying again/), await screen.findByText(/Reload it before trying again/));
  readResult = savedStatus({ enabled: false, hostname: "hooks.example.com", revision: 4 });
  fireEvent.click(screen.getByRole("button", { name: "Reload saved configuration" }));
  assert.equal(await screen.findByText("Configured, disabled"), await screen.findByText("Configured, disabled"));
  assert.equal(document.body.textContent?.includes("https://hooks.example.com/inbound"), false);
  assert.equal(document.getElementById("external-webhook-secret"), null);
});

test("an uncertain save can be retried and a changed URL is not the same request", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveResult = {
    ok: false,
    code: "unavailable",
    message: "The configuration service did not finish. Nothing on this page was marked saved.",
    replayed: false,
    needsReload: false,
    status: null,
    preflight: null,
  };
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  await screen.findByRole("button", { name: "Retry" });
  saveResult = savedStatusResult({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  assert.equal(await screen.findByText("Configuration saved. Lead delivery is OFF."), await screen.findByText("Configuration saved. Lead delivery is OFF."));
  assert.equal(calls.filter((call) => call === "save").length, 2);
  assert.equal(saveIds[0], saveIds[1]);
});

test("changing the URL starts a new request id", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveResult = {
    ok: false,
    code: "unavailable",
    message: "The configuration service did not finish. Nothing on this page was marked saved.",
    replayed: false,
    needsReload: false,
    status: null,
    preflight: null,
  };
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Edit URL" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/other" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  assert.equal(saveIds.length, 2);
  assert.notEqual(saveIds[0], saveIds[1]);
});

test("a request id conflict waits for the operator before another request", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveResult = failure("request_id_conflict", false);
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  assert.equal(await screen.findByText(/already used for a different configuration/), await screen.findByText(/already used for a different configuration/));
  assert.equal((screen.getByRole("button", { name: "Save disabled configuration" }) as HTMLButtonElement).disabled, true);
  assert.equal(saveIds.length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Start a new request" }));
  assert.equal(saveIds.length, 1);
});

test("Enter on the URL form runs the check and does not send a lead", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const url = webhookUrl();
  fireEvent.change(url, { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.submit(url.closest("form")!);
  assert.equal(await screen.findByText(/This check does not send a lead/), await screen.findByText(/This check does not send a lead/));
  assert.equal(calls.includes("preflight"), true);
  assert.equal(calls.includes("save"), false);
});

test("a loading read and a failed read stay off the write actions", async () => {
  let release: () => void = () => undefined;
  readGate = new Promise((resolve) => {
    release = resolve;
  });
  readResult = emptyStatus();
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  assert.equal(screen.getByText("Loading the saved webhook…").textContent, "Loading the saved webhook…");
  assert.equal(screen.queryByRole("button", { name: "Continue" }), null);
  release();
  assert.equal(await screen.findByText("Not configured"), await screen.findByText("Not configured"));
});

test("an uncertain or failed attempt is not described as delivery", async () => {
  readResult = savedStatus({
    latestAttempt: { state: "uncertain", outcome: "uncertain", httpStatus: null, httpAccepted: false, provesCrmCreation: false },
  });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: false, canActivate: false }} />);
  assert.match((await screen.findByText(/cannot confirm whether the receiver accepted/i)).textContent ?? "", /Do not blindly resend/);
  cleanup();
  readResult = savedStatus({
    latestAttempt: { state: "failed", outcome: "rejected", httpStatus: 500, httpAccepted: false, provesCrmCreation: false },
  });
  render(<Guide clientAccountId="client_b" access={{ canPrepare: false, canActivate: false }} />);
  assert.match((await screen.findByText(/did not confirm delivery/i)).textContent ?? "", /HTTP 500/);
});

test("a primary CRM conflict blocks the save and leaves Sheets and native GHL alone", async () => {
  readResult = emptyStatus();
  preflightResult = {
    ok: true,
    code: null,
    message: null,
    replayed: false,
    needsReload: false,
    status: null,
    preflight: {
      postsLead: false,
      hostname: "hooks.example.com",
      endpointValid: true,
      endpointCode: null,
      authValid: true,
      authCode: null,
      credentialsReady: true,
      primaryCrmConflict: true,
      currentRevision: 0,
      revisionMatches: true,
      canaryImplemented: false,
    },
  };
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  assert.equal(await screen.findByText(/Another primary CRM is already active/), await screen.findByText(/Another primary CRM is already active/));
  assert.equal((screen.getByRole("button", { name: "Save disabled configuration" }) as HTMLButtonElement).disabled, true);
  assert.equal(calls.includes("save"), false);
});

test("HTTP acceptance is not described as CRM creation", async () => {
  readResult = savedStatus({
    enabled: true,
    latestAttempt: { state: "attempted", outcome: "http_accepted", httpStatus: 200, httpAccepted: true, provesCrmCreation: false },
  });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: false, canActivate: false }} />);
  const note = await screen.findByText(/does not prove a contact was created/i);
  assert.match(note.textContent ?? "", /successful HTTP response/i);
  assert.equal(/leads are flowing/i.test(document.body.textContent ?? ""), false);
});

test("a primary CRM conflict does not offer a silent overwrite", async () => {
  readResult = savedStatus({ primaryCrmConflict: true, configurationValid: false });
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  assert.equal(await screen.findByText("Conflict or invalid"), await screen.findByText("Conflict or invalid"));
  assert.match(document.body.textContent ?? "", /does not replace a saved native GoHighLevel/i);
});

test("a dropped save can be retried with the same request id", async () => {
  readResult = emptyStatus();
  preflightResult = preflightOk();
  saveThrows = true;
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: false }} />);
  await screen.findByText("Not configured");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(webhookUrl(), { target: { value: "https://hooks.example.com/inbound" } });
  fireEvent.click(screen.getByRole("button", { name: "Check this endpoint" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save disabled configuration" }));
  await screen.findByRole("button", { name: "Retry" });
  saveThrows = false;
  saveResult = savedStatusResult({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  assert.equal(await screen.findByText("Configuration saved. Lead delivery is OFF."), await screen.findByText("Configuration saved. Lead delivery is OFF."));
  assert.equal(saveIds[0], saveIds[1]);
});

test("the feature-off state has no save or activation control", async () => {
  render(<Guide clientAccountId="client_a" access={{ canPrepare: true, canActivate: true }} />);
  assert.equal(await screen.findByText("External webhook configuration is turned off. Nothing can be saved or enabled from this screen."), await screen.findByText("External webhook configuration is turned off. Nothing can be saved or enabled from this screen."));
  assert.equal(screen.queryByRole("button", { name: "Save disabled configuration" }), null);
  assert.equal(screen.queryByRole("button", { name: "Enable this destination" }), null);
});

function webhookUrl(): HTMLInputElement {
  const element = document.getElementById("external-webhook-url");
  assert.ok(element instanceof HTMLInputElement);
  const label = document.querySelector("label[for='external-webhook-url']");
  assert.equal(label?.textContent?.trim(), "Webhook URL");
  return element;
}

function signingSecret(): HTMLInputElement {
  const element = document.getElementById("external-webhook-secret");
  assert.ok(element instanceof HTMLInputElement);
  const label = document.querySelector("label[for='external-webhook-secret']");
  assert.equal(label?.textContent?.trim(), "Signing secret");
  return element;
}

function disabled(): ExternalWebhookBridgeResult {
  return {
    ok: false,
    code: "FEATURE_DISABLED",
    message: "External webhook configuration is turned off. Nothing was saved or enabled.",
    replayed: false,
    needsReload: false,
    status: null,
    preflight: null,
  };
}

function denied(): ExternalWebhookBridgeResult {
  return {
    ok: false,
    code: "forbidden",
    message: "This operator cannot change the external webhook.",
    replayed: false,
    needsReload: false,
    status: null,
    preflight: null,
  };
}

function failure(code: "revision_conflict" | "request_id_conflict", needsReload: boolean): ExternalWebhookBridgeResult {
  return {
    ok: false,
    code,
    message: code === "revision_conflict" ? "The destination changed. Reload it before trying again." : "This request id was already used for a different configuration.",
    replayed: false,
    needsReload,
    status: null,
    preflight: null,
  };
}

function emptyStatus(): ExternalWebhookBridgeResult {
  return {
    ok: true,
    code: null,
    message: null,
    replayed: false,
    needsReload: false,
    preflight: null,
    status: {
      present: false,
      kind: null,
      authMode: null,
      hostname: null,
      enabled: false,
      revision: 0,
      configurationValid: false,
      primaryCrmConflict: false,
      latestAttempt: null,
    },
  };
}

function savedStatus(patch: Partial<Extract<ExternalWebhookBridgeResult, { ok: true }>["status"]> = {}): ExternalWebhookBridgeResult {
  return savedStatusResult(patch);
}

function savedStatusResult(patch: Partial<Extract<ExternalWebhookBridgeResult, { ok: true }>["status"]> = {}): ExternalWebhookBridgeResult {
  return {
    ok: true,
    code: null,
    message: "The disabled destination was saved.",
    replayed: false,
    needsReload: false,
    preflight: null,
    status: {
      present: true,
      kind: "ghl_inbound",
      authMode: "none",
      hostname: "hooks.example.com",
      enabled: false,
      revision: 2,
      configurationValid: true,
      primaryCrmConflict: false,
      latestAttempt: null,
      ...patch,
    },
  };
}

function preflightOk(): ExternalWebhookBridgeResult {
  return {
    ok: true,
    code: null,
    message: null,
    replayed: false,
    needsReload: false,
    status: null,
    preflight: {
      postsLead: false,
      hostname: "hooks.example.com",
      endpointValid: true,
      endpointCode: null,
      authValid: true,
      authCode: null,
      credentialsReady: true,
      primaryCrmConflict: false,
      currentRevision: 0,
      revisionMatches: true,
      canaryImplemented: false,
    },
  };
}
