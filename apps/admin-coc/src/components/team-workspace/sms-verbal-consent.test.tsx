import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { SmsVerbalConsentPanel, type SmsVerbalActions } from "./sms-verbal-consent.tsx";

test("Team Workspace shows the email result and retries only when it was not accepted", async () => {
  let sends = 0;
  const actions: SmsVerbalActions = {
    recordVerbal: async () => {
      sends += 1;
      return { ok: true, status: "pending_confirmation", smsEnabled: false, consentRecorded: false, email: "origin_unconfigured" };
    },
    issueLink: async () => {
      sends += 1;
      return { ok: true, status: "link_only", smsEnabled: false, consentRecorded: false, email: sends > 2 ? "sent" : "email_not_configured" };
    },
    readStatus: async () => ({
      ok: true,
      recipientConsentConfirmed: false,
      smsEnabled: false,
      handsetOwnershipProven: false,
      suppression: "unknown",
      linkOutstanding: true,
      numberOnFile: true,
    }),
  };
  render(<SmsVerbalConsentPanel clientAccountId="client_a" actions={actions} />);
  fireEvent.click(screen.getByRole("button", { name: "Check confirmation status" }));
  assert.match((await screen.findByText(/Recipient consent is not confirmed/)).textContent ?? "", /Texts are off/);
  assert.match(document.body.textContent ?? "", /does not send a message/);
  assert.equal(document.body.textContent?.includes("provider accepted"), false);
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "+15555550100" } });
  fireEvent.change(screen.getByLabelText("Affirmative response"), { target: { value: "Yes, text me." } });
  fireEvent.change(screen.getByLabelText("Confirmation email"), { target: { value: "person@lifeagentlaunch.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Save pending verbal note" }));
  assert.match((await screen.findByText(/was not sent/)).textContent ?? "", /public page origin is not configured/);
  assert.equal(document.body.textContent?.includes("provider accepted"), false);
  fireEvent.click(screen.getByRole("button", { name: "Try the confirmation email again" }));
  assert.match((await screen.findByText(/email is not configured/)).textContent ?? "", /was not sent/);
  fireEvent.click(screen.getByRole("button", { name: "Try the confirmation email again" }));
  assert.match((await screen.findByText(/provider accepted/)).textContent ?? "", /Inbox delivery is not confirmed/);
  assert.equal(screen.queryByRole("button", { name: "Try the confirmation email again" }), null);
  assert.match(document.body.textContent ?? "", /staff-supplied/);
  cleanup();
});
