import type { IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

import { EXTERNAL_WEBHOOK_HTTP_POLICY } from "./external-webhook-url-policy.js";

/**
 * Customer HTTPS POST that connects only to an already approved address.
 * Node's default lookup and autoSelectFamily can resolve the name again.
 * Both are replaced: lookup returns the pin, and autoSelectFamily is off.
 * TLS still checks the certificate against the original hostname (SNI).
 * Redirects are not followed.
 */

export const EXTERNAL_WEBHOOK_MAX_RESPONSE_BYTES = 65_536;

export type PinnedHttpsRequest = {
  hostname: string;
  port: number;
  pathAndQuery: string;
  pinnedAddress: string;
  addressFamily: 4 | 6;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type PinnedHttpsResult = {
  httpStatus: number | null;
  timedOut: boolean;
  requestLeftSa360: boolean;
  refusedRedirect: boolean;
};

export function pinnedAddressLookup(address: string, family: 4 | 6): LookupFunction {
  return ((...args: unknown[]) => {
    const callback = args.at(-1) as (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
    callback(null, address, family);
  }) as LookupFunction;
}

export function pinnedHttpsRequestOptions(input: PinnedHttpsRequest): https.RequestOptions {
  const family = isIP(input.pinnedAddress);
  if (family !== 4 && family !== 6) {
    throw new Error("external_webhook_pin_invalid");
  }
  if (family !== input.addressFamily) {
    throw new Error("external_webhook_pin_invalid");
  }
  return {
    protocol: "https:",
    hostname: input.hostname,
    servername: input.hostname,
    port: input.port,
    path: input.pathAndQuery,
    method: "POST",
    headers: {
      ...input.headers,
      "content-length": Buffer.byteLength(input.body),
    },
    lookup: pinnedAddressLookup(input.pinnedAddress, input.addressFamily),
    rejectUnauthorized: true,
    autoSelectFamily: false,
    timeout: input.timeoutMs,
  } as https.RequestOptions;
}

export type ExternalWebhookHttpsRequest = (
  options: https.RequestOptions,
  callback?: (res: IncomingMessage) => void
) => {
  on(event: string, listener: (...args: any[]) => void): unknown;
  write(body: string): unknown;
  end(): void;
  destroy(): void;
};

export async function postPinnedHttps(
  input: PinnedHttpsRequest,
  request: ExternalWebhookHttpsRequest = https.request as ExternalWebhookHttpsRequest
): Promise<PinnedHttpsResult> {
  if (input.maxResponseBytes < 1) {
    throw new Error("external_webhook_response_bound");
  }
  const options = pinnedHttpsRequestOptions(input);
  return new Promise((resolve) => {
    let connected = false;
    let settled = false;
    const finish = (result: PinnedHttpsResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = request(options, (res) => {
      const status = res.statusCode ?? null;
      const redirect = status !== null && status >= 300 && status <= 399;
      res.destroy();
      finish({
        httpStatus: status,
        timedOut: false,
        requestLeftSa360: true,
        refusedRedirect: redirect,
      });
    });
    req.on("socket", (socket) => {
      socket.on("connect", () => {
        connected = true;
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish({
        httpStatus: null,
        timedOut: true,
        requestLeftSa360: connected,
        refusedRedirect: false,
      });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      const beforeConnect = !connected && isConnectRefusal(err.code);
      finish({
        httpStatus: null,
        timedOut: err.code === "ETIMEDOUT",
        requestLeftSa360: !beforeConnect,
        refusedRedirect: false,
      });
    });
    req.write(input.body);
    req.end();
  });
}

function isConnectRefusal(code: string | undefined): boolean {
  return code === "ECONNREFUSED" || code === "ENETUNREACH" || code === "EHOSTUNREACH" || code === "EAI_AGAIN";
}

export const EXTERNAL_WEBHOOK_POST_TIMEOUT_MS = EXTERNAL_WEBHOOK_HTTP_POLICY.timeoutMs;
