import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_WORKSPACE_EMBED_CSP_HEADER,
  getContentSecurityPolicyForAgentWorkspaceEmbed,
} from "./agent-workspace-embed-security.ts";

test("default CSP includes frame-ancestors and known GHL app hosts", () => {
  delete process.env.GHL_EMBED_FRAME_ANCESTORS;
  const v = getContentSecurityPolicyForAgentWorkspaceEmbed();
  assert.match(v, /^frame-ancestors /);
  assert.ok(v.includes("'self'"));
  assert.ok(v.includes("https://app.gohighlevel.com"));
  assert.ok(v.includes("https://app.leadconnectorhq.com"));
});

test("GHL_EMBED_FRAME_ANCESTORS as source list only is prefixed", () => {
  process.env.GHL_EMBED_FRAME_ANCESTORS = "'self' https://embed.example.test";
  const v = getContentSecurityPolicyForAgentWorkspaceEmbed();
  assert.equal(v, "frame-ancestors 'self' https://embed.example.test");
  delete process.env.GHL_EMBED_FRAME_ANCESTORS;
});

test("GHL_EMBED_FRAME_ANCESTORS starting with frame-ancestors is passed through", () => {
  process.env.GHL_EMBED_FRAME_ANCESTORS =
    "frame-ancestors 'self' https://app.gohighlevel.com https://white-label.example";
  const v = getContentSecurityPolicyForAgentWorkspaceEmbed();
  assert.equal(
    v,
    "frame-ancestors 'self' https://app.gohighlevel.com https://white-label.example"
  );
  delete process.env.GHL_EMBED_FRAME_ANCESTORS;
});

test("header name constant", () => {
  assert.equal(AGENT_WORKSPACE_EMBED_CSP_HEADER, "Content-Security-Policy");
});
