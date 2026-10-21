import test from "node:test";
import assert from "node:assert/strict";
import { resolvePageMeta } from "./page-meta.ts";

test("resolvePageMeta returns Routing Dry Run for /routing-dry-run", () => {
  const meta = resolvePageMeta("/routing-dry-run");
  assert.equal(meta.title, "Routing Dry Run");
  assert.match(meta.description ?? "", /dry-run/i);
});

test("resolvePageMeta returns Lead Fulfillment Overview for /lead-fulfillment", () => {
  const meta = resolvePageMeta("/lead-fulfillment");
  assert.equal(meta.title, "Lead Fulfillment Overview");
  assert.match(meta.description ?? "", /LF1/i);
});

test("resolvePageMeta returns Pivot Archive for /planning/pivot-archive", () => {
  const meta = resolvePageMeta("/planning/pivot-archive");
  assert.equal(meta.title, "Pivot Archive");
  assert.match(meta.description ?? "", /historical/i);
});

test("dashboard routes no longer fall through to Command Center", () => {
  const titles: Record<string, string> = {
    "/fulfillment-ops": "Fulfillment Ops",
    "/lead-inventory": "Lead Inventory",
    "/source-intake": "Source Intake Queue",
    "/source-intake/imports/new": "Bulk Imports",
    "/facebook-intake": "Facebook Intake",
    "/automation-dashboard": "Automation Visibility",
    "/direct-delivery-demo": "Direct Delivery Demo",
    "/ghl-connections": "GHL Connections",
    "/delivery-readiness": "Delivery Readiness",
    "/action-center": "Action Center",
    "/agent-workspace": "Agent Workspace",
    "/orders": "Orders",
    "/front-office/orders": "Lead Orders",
    "/front-office": "Front Office",
    "/front-office/pipeline-studio": "Front Office",
  };
  for (const [path, title] of Object.entries(titles)) {
    assert.equal(resolvePageMeta(path).title, title, path);
    assert.notEqual(resolvePageMeta(path).title, "Command Center", path);
  }
});

test("resolvePageMeta keeps the review route title after the sidebar link is removed", () => {
  assert.equal(resolvePageMeta("/review").title, "Review Queue");
});

test("resolvePageMeta still prefers client detail over the clients directory", () => {
  assert.equal(resolvePageMeta("/clients/acct_1").title, "Client Detail");
  assert.equal(resolvePageMeta("/clients").title, "Clients & Subaccounts");
});
