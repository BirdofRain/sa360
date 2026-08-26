import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PORTAL_ORDER_LINKED_LEAD_FIXTURES } from "@/lib/client-portal/portal-order-fulfillment-fixtures";
import {
  PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE,
  PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE,
  PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR,
} from "@/lib/client-portal/portal-order-leads-api";

import { PortalOrderLinkedLeads } from "./portal-order-linked-leads.tsx";

test("empty linked leads is honest and is not an API-unavailable state", () => {
  render(<PortalOrderLinkedLeads leads={[]} />);
  assert.ok(screen.getByText(PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE));
  assert.equal(screen.queryByText(PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR), null);
  assert.equal(screen.queryByText("Leads could not be loaded"), null);
  cleanup();
});

test("a failed linked-leads request does not use the empty copy", () => {
  render(<PortalOrderLinkedLeads leads={PORTAL_ORDER_LINKED_LEAD_FIXTURES} error="boom" />);
  assert.ok(screen.getByText(PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR));
  assert.equal(screen.queryByText(PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE), null);
  assert.equal(screen.queryByText("Alex P."), null);
  cleanup();
});

test("documents first-page-only when nextCursor is present", () => {
  render(<PortalOrderLinkedLeads leads={PORTAL_ORDER_LINKED_LEAD_FIXTURES} hasMore />);
  assert.ok(screen.getAllByText(PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE).length >= 1);
  cleanup();
});
