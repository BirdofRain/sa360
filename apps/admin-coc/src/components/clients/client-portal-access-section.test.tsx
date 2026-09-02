import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  PORTAL_DISABLED_INVITE_COPY,
  PORTAL_INVITE_GENERIC_ERROR,
  PORTAL_INVITE_REISSUE_CONFIRM,
  PORTAL_INVITE_RESET_SESSION_COPY,
  PORTAL_MISSING_EMAIL_INVITE_COPY,
  PORTAL_PASSWORD_SET_HEADING,
  PORTAL_PASSWORD_STATUS_NOT_SET,
  PORTAL_PASSWORD_STATUS_SET,
} from "@/lib/clients/portal-invite-operator";
import {
  PORTAL_CANCEL_LOGIN_EMAIL_LABEL,
  PORTAL_CURRENT_LOGIN_EMAIL_LABEL,
  PORTAL_EDIT_LOGIN_EMAIL_LABEL,
  PORTAL_NEW_LOGIN_EMAIL_LABEL,
  PORTAL_UNSAVED_EMAIL_INVITE_COPY,
} from "@/lib/clients/portal-login-email-edit";
import type { ClientAccountDetail } from "@/lib/clients/types";

import {
  ClientPortalAccessSection,
  type ClientPortalAccessIssueAction,
} from "./client-portal-access-section.tsx";

const INVITE_URL = "https://portal.example/portal/invite/rawInviteTokenValue0123456789abcd";
const EXPIRES_AT = "2026-09-03T15:30:00.000Z";
const originalConfirm = window.confirm;

function client(overrides: Partial<ClientAccountDetail> = {}): ClientAccountDetail {
  return {
    clientAccountId: "acct_valley",
    clientDisplayName: "Valley Vet",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: "Valley Portal",
    portalLoginEmail: "alex@example.com",
    hasPortalPassword: false,
    hasOutstandingPortalInvite: false,
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["final_expense"],
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ghlDestination: null,
    routingRules: [],
    destinationReadiness: null,
    activeRoutingRuleCount: 0,
    ...overrides,
  };
}

function issueOk(): ClientPortalAccessIssueAction {
  return async () => ({ ok: true, inviteUrl: INVITE_URL, expiresAt: EXPIRES_AT });
}

test.afterEach(() => {
  cleanup();
  window.confirm = originalConfirm;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("portal disabled blocks generate invite and explains enable-first", () => {
  render(
    <ClientPortalAccessSection
      client={client({ portalEnabled: false })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  assert.equal(screen.queryByRole("button", { name: "Generate portal invite" }), null);
  assert.ok(screen.getByText(PORTAL_DISABLED_INVITE_COPY));
});

test("missing portal login email blocks generate invite", () => {
  render(
    <ClientPortalAccessSection
      client={client({ portalLoginEmail: null })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  assert.equal(screen.queryByRole("button", { name: "Generate portal invite" }), null);
  assert.ok(screen.getByText(PORTAL_MISSING_EMAIL_INVITE_COPY));
});

test("eligible client generate invite calls the existing issuance action", async () => {
  const calls: string[] = [];
  const issueInviteAction: ClientPortalAccessIssueAction = async (id) => {
    calls.push(id);
    return { ok: true, inviteUrl: INVITE_URL, expiresAt: EXPIRES_AT };
  };
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueInviteAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.deepEqual(calls, ["acct_valley"]);
  });
});

test("successful issuance shows invite ready, expiry, and copy invite link", async () => {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => writes.push(text) },
  });
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Portal invite ready"));
  });
  assert.ok(screen.getByText(/Expires:/));
  fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
  await waitFor(() => {
    assert.deepEqual(writes, [INVITE_URL]);
  });
});

test("raw invite is not stored in persistent browser state", async () => {
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Portal invite ready"));
  });
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(document.cookie.includes("rawInviteTokenValue"), false);
  assert.equal(window.location.search.includes("rawInviteTokenValue"), false);
});

test("generate again warns that the previous invite will be invalidated", async () => {
  const confirms: string[] = [];
  window.confirm = (message?: string) => {
    confirms.push(String(message ?? ""));
    return true;
  };
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.ok(screen.getByText("Portal invite ready"));
  });
  assert.equal(confirms.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.ok(confirms.includes(PORTAL_INVITE_REISSUE_CONFIRM));
  });
});

test("hasPortalPassword false renders Not set", () => {
  render(
    <ClientPortalAccessSection
      client={client({ hasPortalPassword: false })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  assert.ok(screen.getByText("Password status"));
  assert.ok(screen.getByText(PORTAL_PASSWORD_STATUS_NOT_SET));
  assert.equal(screen.queryByText(PORTAL_PASSWORD_SET_HEADING), null);
  assert.equal(screen.queryByText("CLIENT_PORTAL_LOGIN_PASSWORD"), null);
  assert.equal(screen.queryByText(/Show Password/i), null);
});

test("hasPortalPassword true renders Password set and reset invite, never Show Password", () => {
  const { container } = render(
    <ClientPortalAccessSection
      client={client({ hasPortalPassword: true })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  assert.ok(screen.getByText(PORTAL_PASSWORD_STATUS_SET));
  assert.ok(screen.getByText(PORTAL_PASSWORD_SET_HEADING));
  assert.ok(screen.getByRole("button", { name: "Generate password reset invite" }));
  assert.equal(screen.queryByRole("button", { name: "Generate portal invite" }), null);
  assert.equal(screen.queryByText(/Show Password/i), null);
  assert.ok(screen.getByText(PORTAL_INVITE_RESET_SESSION_COPY));
  assert.equal(container.textContent?.includes("portalPasswordHash"), false);
  assert.equal(container.textContent?.includes("CLIENT_PORTAL_LOGIN_PASSWORD"), false);
});

test("outstanding invite confirms before first generate in this session", () => {
  const confirms: string[] = [];
  window.confirm = (message?: string) => {
    confirms.push(String(message ?? ""));
    return false;
  };
  const issueInviteAction: ClientPortalAccessIssueAction = async () => {
    throw new Error("should not issue when confirm is cancelled");
  };
  render(
    <ClientPortalAccessSection
      client={client({ hasOutstandingPortalInvite: true })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueInviteAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  assert.deepEqual(confirms, [PORTAL_INVITE_REISSUE_CONFIRM]);
});

test("API error produces safe operator copy and no secret fields in the DOM", async () => {
  const issueInviteAction: ClientPortalAccessIssueAction = async () => ({
    ok: false,
    error: PORTAL_INVITE_GENERIC_ERROR,
  });
  const { container } = render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueInviteAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.ok(screen.getByRole("alert"));
  });
  assert.equal(screen.getByRole("alert").textContent, PORTAL_INVITE_GENERIC_ERROR);
  assert.equal(container.innerHTML.includes("portalPasswordHash"), false);
  assert.equal(container.innerHTML.includes("inviteTokenHash"), false);
  assert.equal(container.innerHTML.includes("portalInviteTokenHash"), false);
});

test("default view shows the saved email once and has no editable email input", () => {
  const { container } = render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  const identity = screen.getByTestId("portal-login-email-identity");
  assert.equal(identity.textContent, "alex@example.com");
  assert.equal(container.querySelectorAll('input[name="portalLoginEmail"]').length, 0);
  assert.equal(container.querySelectorAll('input[type="email"]').length, 0);
  assert.equal(screen.queryByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), null);
  assert.equal(screen.queryByText(PORTAL_CURRENT_LOGIN_EMAIL_LABEL), null);
  assert.ok(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
});

test("Edit reveals an input initialized from the saved canonical email", () => {
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
  const input = screen.getByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL) as HTMLInputElement;
  assert.equal(input.value, "alex@example.com");
  assert.equal(input.getAttribute("name"), "portalLoginEmail");
  assert.equal(input.getAttribute("autocomplete"), "off");
  assert.ok(screen.getByText(PORTAL_CURRENT_LOGIN_EMAIL_LABEL));
  assert.equal(screen.getByTestId("portal-login-email-identity").textContent, "alex@example.com");
});

test("Cancel removes the edit UI and changes nothing", () => {
  let submitted: FormData | null = null;
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={(e) => {
        e.preventDefault();
        submitted = new FormData(e.currentTarget);
      }}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
  fireEvent.change(screen.getByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), {
    target: { value: "operator@admin.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: PORTAL_CANCEL_LOGIN_EMAIL_LABEL }));
  assert.equal(screen.queryByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), null);
  assert.equal(screen.getByTestId("portal-login-email-identity").textContent, "alex@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Save portal settings" }));
  assert.ok(submitted);
  assert.equal(submitted.has("portalLoginEmail"), false);
});

test("Save submits the intentional new email only after Edit", () => {
  let submitted: FormData | null = null;
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={(e) => {
        e.preventDefault();
        submitted = new FormData(e.currentTarget);
      }}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
  fireEvent.change(screen.getByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), {
    target: { value: "new.owner@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save portal settings" }));
  assert.ok(submitted);
  assert.equal(submitted.get("portalLoginEmail"), "new.owner@example.com");
});

test("browser-like mutation cannot affect saved state before Edit", () => {
  let submitted: FormData | null = null;
  const { container } = render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={(e) => {
        e.preventDefault();
        submitted = new FormData(e.currentTarget);
      }}
      issueInviteAction={issueOk()}
    />
  );
  const injected = document.createElement("input");
  injected.type = "email";
  injected.name = "portalLoginEmail";
  injected.value = "operator@admin.example";
  container.appendChild(injected);
  assert.equal(screen.getByTestId("portal-login-email-identity").textContent, "alex@example.com");
  fireEvent.change(screen.getByLabelText("Portal display name"), {
    target: { value: "operator@admin.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save portal settings" }));
  assert.ok(submitted);
  assert.equal(submitted.has("portalLoginEmail"), false);
  assert.equal(screen.getByTestId("portal-login-email-identity").textContent, "alex@example.com");
});

test("invite uses the persisted server identity and unsaved email edit blocks generate", async () => {
  const calls: string[] = [];
  const issueInviteAction: ClientPortalAccessIssueAction = async (id) => {
    calls.push(id);
    return { ok: true, inviteUrl: INVITE_URL, expiresAt: EXPIRES_AT };
  };
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueInviteAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate portal invite" }));
  await waitFor(() => {
    assert.deepEqual(calls, ["acct_valley"]);
  });
  fireEvent.click(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
  fireEvent.change(screen.getByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), {
    target: { value: "operator@admin.example" },
  });
  const generate = screen.getByRole("button", { name: "Generate portal invite" });
  assert.equal((generate as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText(PORTAL_UNSAVED_EMAIL_INVITE_COPY));
  fireEvent.click(generate);
  assert.deepEqual(calls, ["acct_valley"]);
});

test("successful save closes edit mode and uses the newly saved server email", () => {
  const { rerender } = render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: PORTAL_EDIT_LOGIN_EMAIL_LABEL }));
  fireEvent.change(screen.getByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), {
    target: { value: "new.owner@example.com" },
  });
  rerender(
    <ClientPortalAccessSection
      client={client({
        portalLoginEmail: "new.owner@example.com",
        updatedAt: "2026-01-03T00:00:00.000Z",
      })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueOk()}
    />
  );
  assert.equal(screen.queryByLabelText(PORTAL_NEW_LOGIN_EMAIL_LABEL), null);
  assert.equal(screen.getByTestId("portal-login-email-identity").textContent, "new.owner@example.com");
  assert.ok(screen.getByRole("button", { name: "Generate portal invite" }));
});

test("portal enable and display name remain saveable without opening email edit", () => {
  let saved = false;
  render(
    <ClientPortalAccessSection
      client={client()}
      pending={false}
      onSave={(e) => {
        e.preventDefault();
        saved = true;
      }}
      issueInviteAction={issueOk()}
    />
  );
  const enabled = screen.getByLabelText("Portal enabled") as HTMLInputElement;
  assert.equal(enabled.checked, true);
  assert.ok(screen.getByLabelText("Portal display name"));
  fireEvent.click(screen.getByRole("button", { name: "Save portal settings" }));
  assert.equal(saved, true);
});

test("converted customer reset invite uses the same issuance action", async () => {
  const calls: string[] = [];
  const issueInviteAction: ClientPortalAccessIssueAction = async (id) => {
    calls.push(id);
    return { ok: true, inviteUrl: INVITE_URL, expiresAt: EXPIRES_AT };
  };
  render(
    <ClientPortalAccessSection
      client={client({ hasPortalPassword: true })}
      pending={false}
      onSave={() => undefined}
      issueInviteAction={issueInviteAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate password reset invite" }));
  await waitFor(() => {
    assert.deepEqual(calls, ["acct_valley"]);
    assert.ok(screen.getByText("Portal invite ready"));
  });
});
