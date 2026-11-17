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
        if (calls === 1) return { ok: false, message: "This number is stopped. Consent was not recorded and texts stay off." };
        return { ok: true, message: "Recipient consent is confirmed. Texts are on. Handset ownership was not independently proven." };
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
