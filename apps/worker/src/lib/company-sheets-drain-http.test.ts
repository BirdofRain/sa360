import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { CompanySheetsDrainTimeoutError, postCompanySheetsDrain } from "./company-sheets-drain-http.js";

function listen(server: http.Server | net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: http.Server | net.Server, sockets: readonly net.Socket[] = []): Promise<void> {
  if (server instanceof http.Server) server.closeAllConnections?.();
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}

function waitForClose(socket: net.Socket | undefined): Promise<void> {
  if (!socket) return Promise.reject(new Error("missing socket"));
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket was not closed")), 500);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const drainUrl = (port: number, protocol: "http:" | "https:" = "http:") =>
  `${protocol}//127.0.0.1:${port}/admin/v1/company-sheets/internal/process-dispatch`;

test("a stalled response times out once and destroys the socket", { timeout: 5_000 }, async () => {
  const sockets: net.Socket[] = [];
  let requests = 0;
  const server = http.createServer((req) => {
    requests += 1;
    sockets.push(req.socket);
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () =>
        postCompanySheetsDrain({
          url: drainUrl(port),
          headers: { "x-sa360-admin-key": "worker-admin-key" },
          body: "{}",
          timeoutMs: 80,
        }),
      (err: unknown) => err instanceof CompanySheetsDrainTimeoutError
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.destroyed, true);
  } finally {
    await close(server, sockets);
  }
});

test("a stalled body after response headers times out once and destroys the socket", { timeout: 5_000 }, async () => {
  const sockets: net.Socket[] = [];
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    sockets.push(req.socket);
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"ok":true');
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () =>
        postCompanySheetsDrain({
          url: drainUrl(port),
          headers: {},
          body: "{}",
          timeoutMs: 80,
        }),
      (err: unknown) => err instanceof CompanySheetsDrainTimeoutError
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    assert.equal(sockets[0]?.destroyed, true);
  } finally {
    await close(server, sockets);
  }
});

test("an unfinished TLS handshake is one connection inside the same deadline", { timeout: 5_000 }, async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.resume();
  });
  const port = await listen(server);
  const started = Date.now();
  try {
    await assert.rejects(
      () =>
        postCompanySheetsDrain({
          url: drainUrl(port, "https:"),
          headers: { "x-sa360-admin-key": "worker-admin-key" },
          body: "{}",
          timeoutMs: 150,
        }),
      (err: unknown) => err instanceof CompanySheetsDrainTimeoutError
    );
    assert.ok(Date.now() - started < 1_000);
    assert.equal(sockets.length, 1);
    await waitForClose(sockets[0]);
    assert.equal(sockets[0]?.destroyed, true);
  } finally {
    await close(server, sockets);
  }
});

test("a delayed 200 clears the deadline so the socket stays open", { timeout: 5_000 }, async () => {
  const sockets: net.Socket[] = [];
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    sockets.push(req.socket);
    setTimeout(() => {
      const body = JSON.stringify({ ok: true, processed: 0, executed: 0 });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    }, 40);
  });
  const port = await listen(server);
  try {
    const result = await postCompanySheetsDrain({
      url: drainUrl(port),
      headers: {},
      body: "{}",
      timeoutMs: 120,
    });
    assert.equal(result.status, 200);
    assert.equal(requests, 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(requests, 1);
    assert.equal(sockets[0]?.destroyed, false);
  } finally {
    await close(server, sockets);
  }
});
