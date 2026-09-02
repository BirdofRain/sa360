import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_PASSWORD_MISMATCH, PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";

import { PortalInviteForm } from "./portal-invite-form.tsx";

test("invite form shows two password fields and the length policy without tenant metadata", () => {
  render(<PortalInviteForm token="tok_should_not_render_as_visible_copy" />);
  const password = screen.getByLabelText("New password");
  const confirm = screen.getByLabelText("Confirm new password");
  assert.equal(password.getAttribute("type"), "password");
  assert.equal(confirm.getAttribute("type"), "password");
  assert.equal(password.getAttribute("autocomplete"), "new-password");
  assert.equal(confirm.getAttribute("autocomplete"), "new-password");
  assert.equal(password.getAttribute("minlength"), "10");
  assert.equal(confirm.getAttribute("minlength"), "10");
  assert.equal(password.getAttribute("maxlength"), "128");
  assert.equal(confirm.getAttribute("maxlength"), "128");
  assert.ok(password.hasAttribute("required"));
  assert.ok(confirm.hasAttribute("required"));
  assert.ok(screen.getByText(PORTAL_PASSWORD_POLICY_COPY));
  assert.ok(screen.getByLabelText("Show passwords"));
  assert.equal(screen.queryByText(/tok_should_not_render_as_visible_copy/), null);
  assert.equal(screen.queryByText(/acct_/), null);
  assert.equal(screen.queryByText(/hash/i), null);
  cleanup();
});

test("mismatching confirmation shows customer-safe copy and does not reveal the token", () => {
  render(<PortalInviteForm token={"a".repeat(43)} />);
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "long-enough-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "different-password" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Save password and continue" }).closest("form")!);
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.getByRole("alert").textContent, PORTAL_PASSWORD_MISMATCH);
  assert.equal(screen.queryByText("long-enough-password"), null);
  assert.equal(screen.queryByText("different-password"), null);
  cleanup();
});

test("show passwords toggles both fields without adding a second token surface", () => {
  render(<PortalInviteForm token={"b".repeat(43)} />);
  fireEvent.click(screen.getByLabelText("Show passwords"));
  assert.equal(screen.getByLabelText("New password").getAttribute("type"), "text");
  assert.equal(screen.getByLabelText("Confirm new password").getAttribute("type"), "text");
  cleanup();
});
