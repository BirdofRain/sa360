import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { agentWorkspaceRoutes } from "./agent-workspace.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";

async function buildWorkspaceApp() {
  const app = Fastify({ logger: false });
  await app.register(agentWorkspaceRoutes, { prefix: "/agent-workspace/v1" });
  return app;
}

test("GET /agent-workspace/v1/context → 503 when workspace API key env unset", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  const prevS = process.env.SA360_WORKSPACE_SECRET;
  delete process.env.AGENT_WORKSPACE_API_KEY;
  delete process.env.SA360_WORKSPACE_SECRET;
  const app = await buildWorkspaceApp();
  const res = await app.inject({
    method: "GET",
    url: "/agent-workspace/v1/context?clientAccountId=c1",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
  if (prevS !== undefined) process.env.SA360_WORKSPACE_SECRET = prevS;
  else delete process.env.SA360_WORKSPACE_SECRET;
});

test("GET /agent-workspace/v1/context → 401 when key wrong", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  process.env.AGENT_WORKSPACE_API_KEY = "ws-secret";
  const app = await buildWorkspaceApp();
  const res = await app.inject({
    method: "GET",
    url: "/agent-workspace/v1/context?clientAccountId=c1",
    headers: { [WORKSPACE_KEY_HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
});

test("GET /agent-workspace/v1/context → 400 when query invalid", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  process.env.AGENT_WORKSPACE_API_KEY = "ws-secret";
  const app = await buildWorkspaceApp();
  const res = await app.inject({
    method: "GET",
    url: "/agent-workspace/v1/context",
    headers: { [WORKSPACE_KEY_HEADER]: "ws-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
});

test("POST /agent-workspace/v1/actions/what-happened → 400 when body invalid", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  process.env.AGENT_WORKSPACE_API_KEY = "ws-secret";
  const app = await buildWorkspaceApp();
  const res = await app.inject({
    method: "POST",
    url: "/agent-workspace/v1/actions/what-happened",
    headers: {
      [WORKSPACE_KEY_HEADER]: "ws-secret",
      "content-type": "application/json",
    },
    payload: JSON.stringify({ clientAccountId: "c1", outcome: "no_answer" }),
  });
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
});

test("GET /agent-workspace/v1/guidance → 400 when clientAccountId missing", async () => {
  const prev = process.env.AGENT_WORKSPACE_API_KEY;
  process.env.AGENT_WORKSPACE_API_KEY = "ws-secret";
  const app = await buildWorkspaceApp();
  const res = await app.inject({
    method: "GET",
    url: "/agent-workspace/v1/guidance",
    headers: { [WORKSPACE_KEY_HEADER]: "ws-secret" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
  if (prev !== undefined) process.env.AGENT_WORKSPACE_API_KEY = prev;
  else delete process.env.AGENT_WORKSPACE_API_KEY;
});
