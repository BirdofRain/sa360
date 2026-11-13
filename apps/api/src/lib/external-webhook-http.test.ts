import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";

import {
  pinnedAddressLookup,
  pinnedHttpsRequestOptions,
  postPinnedHttps,
  type ExternalWebhookHttpsRequest,
} from "./external-webhook-http.js";

const base = {
  hostname: "hooks.example.com",
  port: 443,
  pathAndQuery: "/hook/path-token?x=1",
  pinnedAddress: "8.8.8.8",
  addressFamily: 4 as const,
  body: "{\"ok\":true}",
  headers: { "content-type": "application/json" },
  timeoutMs: 10_000,
  maxResponseBytes: 1024,
};

test("the pinned lookup ignores a later DNS answer and keeps TLS on the hostname", () => {
  const options = pinnedHttpsRequestOptions(base);
  assert.equal(options.hostname, "hooks.example.com");
  assert.equal(options.servername, "hooks.example.com");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal((options as { autoSelectFamily?: boolean }).autoSelectFamily, false);
  assert.equal(options.path, "/hook/path-token?x=1");
  let observed = "";
  options.lookup?.("rebinding.example.com", {}, (err, address) => {
    assert.equal(err, null);
    observed = String(address);
  });
  assert.equal(observed, "8.8.8.8");
  const direct = pinnedAddressLookup("203.0.113.10", 4);
  direct("metadata.google.internal", {}, (_err, address) => {
    assert.equal(address, "203.0.113.10");
  });
});

test("redirects and timeouts are classified without a second request", async () => {
  let calls = 0;
  const redirect = await postPinnedHttps(base, ((options, callback) => {
    calls += 1;
    assert.equal(options.hostname, "hooks.example.com");
    return fakeRequest(() => {
      callback?.({
        statusCode: 302,
        destroy() {},
      } as IncomingMessage);
    });
  }) as ExternalWebhookHttpsRequest);
  assert.equal(calls, 1);
  assert.equal(redirect.refusedRedirect, true);
  assert.equal(redirect.requestLeftSa360, true);
  assert.equal(redirect.httpStatus, 302);

  const refused = await postPinnedHttps(base, (() => {
    return fakeRequest((handlers) => {
      const error = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      handlers.error?.(error);
    });
  }) as ExternalWebhookHttpsRequest);
  assert.equal(refused.requestLeftSa360, false);
  assert.equal(refused.timedOut, false);

  const timedOut = await postPinnedHttps(base, (() => {
    return fakeRequest((handlers) => {
      handlers.socket?.({
        on(event: string, cb: () => void) {
          if (event === "connect") cb();
        },
      });
      handlers.timeout?.();
    });
  }) as ExternalWebhookHttpsRequest);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.requestLeftSa360, true);
});

function fakeRequest(onEnd: (handlers: Record<string, (...args: any[]) => void>) => void) {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    on(event: string, cb: (...args: any[]) => void) {
      handlers[event] = cb;
      return this;
    },
    write() {
      return true;
    },
    end() {
      onEnd(handlers);
    },
    destroy() {},
  };
}
