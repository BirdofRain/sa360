import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { getAgentWorkspaceApiKey, verifyAgentWorkspaceApiKey } from "./workspace-auth.js";

test("getAgentWorkspaceApiKey: undefined when env unset", () => {
  const prevA = process.env.AGENT_WORKSPACE_API_KEY;
  const prevB = process.env.SA360_WORKSPACE_SECRET;
  delete process.env.AGENT_WORKSPACE_API_KEY;
  delete process.env.SA360_WORKSPACE_SECRET;
  assert.equal(getAgentWorkspaceApiKey(), undefined);
  if (prevA !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prevA;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
  if (prevB !== undefined) process.env.SA360_WORKSPACE_SECRET = prevB;
  else delete process.env.SA360_WORKSPACE_SECRET;
});

test("getAgentWorkspaceApiKey: reads SA360_WORKSPACE_SECRET when AGENT_WORKSPACE_API_KEY unset", () => {
  const prevA = process.env.AGENT_WORKSPACE_API_KEY;
  const prevB = process.env.SA360_WORKSPACE_SECRET;
  delete process.env.AGENT_WORKSPACE_API_KEY;
  process.env.SA360_WORKSPACE_SECRET = "from-do";
  assert.equal(getAgentWorkspaceApiKey(), "from-do");
  if (prevA !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prevA;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
  if (prevB !== undefined) process.env.SA360_WORKSPACE_SECRET = prevB;
  else delete process.env.SA360_WORKSPACE_SECRET;
});

test("verifyAgentWorkspaceApiKey sends 503 when workspace API key env unset", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  const prevS = process.env.SA360_WORKSPACE_SECRET;
  delete process.env.AGENT_WORKSPACE_API_KEY;
  delete process.env.SA360_WORKSPACE_SECRET;
  const app = Fastify({ logger: false });
  app.get("/probe", async (request, reply) => {
    const ok = await verifyAgentWorkspaceApiKey(request, reply);
    return ok ? { ok: true } : null;
  });
  const res = await app.inject({ method: "GET", url: "/probe" });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
  if (prevS !== undefined) process.env.SA360_WORKSPACE_SECRET = prevS;
  else delete process.env.SA360_WORKSPACE_SECRET;
});
