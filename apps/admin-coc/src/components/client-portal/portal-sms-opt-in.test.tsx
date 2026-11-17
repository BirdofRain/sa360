import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_SMS_OPT_IN_PREVIEW, PortalSmsOptInForm } from "./portal-sms-opt-in.tsx";

test("the SMS opt-in form starts unchecked and does not invent legal links", () => {
  render(<PortalSmsOptInForm preview={PORTAL_SMS_OPT_IN_PREVIEW} />);
  assert.equal(screen.getByRole("checkbox").getAttribute("checked"), null);
  assert.equal((screen.getByRole("checkbox") as HTMLInputElement).checked, false);
  assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByRole("link", { name: "Privacy Policy" }), null);
  assert.equal(screen.queryByRole("link", { name: "Terms" }), null);
  const text = document.body.textContent ?? "";
  assert.match(text, /Privacy Policy is not published/);
  assert.match(text, /Recipient consent is not confirmed/);
  assert.match(text, /Handset ownership is not independently proven/);
  assert.match(text, /Life Agent Launch/);
  assert.match(text, /Message frequency varies/);
  assert.match(text, /Message and data rates may apply/);
  assert.match(text, /Reply STOP to opt out/);
  assert.match(text, /Reply HELP for help/);
  assert.match(text, /GoHighLevel account/);
  assert.match(text, /Portal login is not required/);
  cleanup();
});

test("a published disclosure can be affirmed and still does not claim consent", () => {
  render(
    <PortalSmsOptInForm
      preview={{
        ...PORTAL_SMS_OPT_IN_PREVIEW,
        recordable: true,
        privacyPolicyUrl: "https://policies.lifeagentlaunch.invalid/privacy",
        termsUrl: "https://policies.lifeagentlaunch.invalid/terms",
      }}
    />
  );
  const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  assert.equal(button.disabled, true);
  fireEvent.click(screen.getByRole("checkbox"));
  assert.equal(button.disabled, false);
  assert.equal(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"), "https://policies.lifeagentlaunch.invalid/privacy");
  assert.match(document.body.textContent ?? "", /Recipient consent is not confirmed/);
  cleanup();
});

test("a failed confirmation is shown and a success cannot be submitted twice", async () => {
  let calls = 0;
  const view = render(
    <PortalSmsOptInForm
      preview={{
        ...PORTAL_SMS_OPT_IN_PREVIEW,
        recordable: true,
        phoneMasked: "+1••••1908",
        phoneSource: "staff_supplied",
        privacyPolicyUrl: "https://policies.lifeagentlaunch.invalid/privacy",
        termsUrl: "https://policies.lifeagentlaunch.invalid/terms",
      }}
      action={async () => {
        calls += 1;
        if (calls === 1) return { ok: false, outcome: "declined", message: "This number is stopped. Consent was not recorded and texts stay off." };
        return { ok: true, outcome: "confirmed", message: "Recipient consent is confirmed. Texts are on. Handset ownership was not independently proven." };
      }}
    />
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  assert.match((await screen.findByText(/This number is stopped/)).textContent ?? "", /Consent was not recorded/);
  assert.match(document.body.textContent ?? "", /supplied by staff/);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const confirmed = await screen.findAllByText(/Recipient consent is confirmed/);
  assert.match(confirmed[confirmed.length - 1]?.textContent ?? "", /Texts are on/);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  assert.equal(calls, 2);
  assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, true);
  view.unmount();
  cleanup();
});

test("a lost confirmation does not claim consent failed and does not submit again", async () => {
  let posts = 0;
  let checks = 0;
  const view = render(
    <PortalSmsOptInForm
      preview={{
        ...PORTAL_SMS_OPT_IN_PREVIEW,
        recordable: true,
        phoneMasked: "+1••••1908",
        phoneSource: "staff_supplied",
        privacyPolicyUrl: "https://policies.lifeagentlaunch.invalid/privacy",
        termsUrl: "https://policies.lifeagentlaunch.invalid/terms",
      }}
      action={async () => {
        posts += 1;
        return {
          ok: false,
          outcome: "unknown",
          message: "The confirmation result cannot be confirmed. It may already have been recorded. This page will not send the request again.",
        };
      }}
      reconcile={async () => {
        checks += 1;
        return {
          ok: false,
          outcome: "unknown",
          message: "This link cannot show whether consent was recorded. A used link stays used. An authorized operator can check the account.",
        };
      }}
    />
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Check the saved result" });
  assert.match(document.body.textContent ?? "", /cannot be confirmed/);
  assert.match(document.body.textContent ?? "", /may already have been recorded/);
  assert.equal(document.body.textContent?.includes("texts stay off"), false);
  assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Check the saved result" }));
  assert.match((await screen.findByText(/cannot show whether consent was recorded/)).textContent ?? "", /authorized operator/);
  assert.equal(posts, 1);
  assert.equal(checks, 1);
  assert.equal(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("rel"), "noreferrer");
  view.unmount();
  cleanup();
});

test("an unreadable link does not claim that texts are off", () => {
  render(
    <PortalSmsOptInForm
      preview={{
        ...PORTAL_SMS_OPT_IN_PREVIEW,
        purpose:
          "This link cannot show whether consent was recorded. A used link stays used. An authorized operator can check the account.",
        statusKnown: false,
      }}
      reconcile={async () => ({
        ok: false,
        outcome: "unknown",
        message: "This link cannot show whether consent was recorded.",
      })}
    />
  );
  const text = document.body.textContent ?? "";
  assert.match(text, /cannot show whether consent was recorded/);
  assert.equal(text.includes("Texts are off"), false);
  assert.equal(text.includes("Consent was not recorded"), false);
  assert.equal(text.includes("Handset ownership is not independently proven"), false);
  assert.equal((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled, true);
  cleanup();
});
