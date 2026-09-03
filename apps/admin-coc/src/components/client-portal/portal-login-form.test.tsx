import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_FORGOT_PASSWORD_LINK, PORTAL_FORGOT_PASSWORD_PATH } from "@/lib/client-portal/portal-password-reset-flow";

import { PortalLoginForm } from "./portal-login-form.tsx";

test("login form exposes Forgot password? without account or tenant ids", () => {
  render(<PortalLoginForm next="/portal" />);
  const link = screen.getByRole("link", { name: PORTAL_FORGOT_PASSWORD_LINK });
  assert.equal(link.getAttribute("href"), PORTAL_FORGOT_PASSWORD_PATH);
  assert.equal(screen.queryByText(/acct_/), null);
  assert.equal(screen.queryByText(/clientAccountId/i), null);
  assert.equal(screen.queryByText(/shared/i), null);
  cleanup();
});
