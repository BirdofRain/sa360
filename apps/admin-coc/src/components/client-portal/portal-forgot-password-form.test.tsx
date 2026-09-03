import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import {
  PORTAL_FORGOT_PASSWORD_EMAIL_LABEL,
  PORTAL_FORGOT_PASSWORD_SUBMIT,
} from "@/lib/client-portal/portal-password-reset-flow";

import { PortalForgotPasswordForm } from "./portal-forgot-password-form.tsx";

test("forgot-password form asks only for portal login email", () => {
  render(<PortalForgotPasswordForm />);
  const email = screen.getByLabelText(PORTAL_FORGOT_PASSWORD_EMAIL_LABEL);
  assert.equal(email.getAttribute("type"), "email");
  assert.equal(email.getAttribute("name"), "email");
  assert.ok(screen.getByRole("button", { name: PORTAL_FORGOT_PASSWORD_SUBMIT }));
  assert.equal(screen.queryByLabelText(/password/i), null);
  assert.equal(screen.queryByText(/acct_/), null);
  assert.equal(screen.queryByText(/tenant/i), null);
  cleanup();
});
