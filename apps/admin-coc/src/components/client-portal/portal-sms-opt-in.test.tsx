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
  assert.match(text, /Consent is not on file/);
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
  assert.match(document.body.textContent ?? "", /Consent is not on file/);
  cleanup();
});
