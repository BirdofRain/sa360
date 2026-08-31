import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";

import { PortalInviteForm } from "./portal-invite-form.tsx";

test("invite form documents the length policy and does not show tenant metadata", () => {
  render(<PortalInviteForm token="tok_should_not_render_as_visible_copy" />);
  assert.ok(screen.getByLabelText(/New password/i));
  assert.ok(screen.getByText(PORTAL_PASSWORD_POLICY_COPY));
  assert.equal(screen.queryByText(/tok_should_not_render_as_visible_copy/), null);
  assert.equal(screen.queryByText(/acct_/), null);
  assert.equal(screen.queryByText(/hash/i), null);
  cleanup();
});
