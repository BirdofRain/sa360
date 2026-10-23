import http from "node:http";
import https from "node:https";

const MAX_RESPONSE_BYTES = 65_536;

/**
 * The worker gave up waiting. Destroying this socket does not cancel the API
 * handler and this function does not send another request.
 */
export class CompanySheetsDrainTimeoutError extends Error {
  constructor() {
    super("company_sheets_dispatch_timeout");
    this.name = "CompanySheetsDrainTimeoutError";
  }
}

export type CompanySheetsDrainRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type CompanySheetsDrainResponse = {
  status: number;
  body: string;
};

export async function postCompanySheetsDrain(
  input: CompanySheetsDrainRequest
): Promise<CompanySheetsDrainResponse> {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error("company_sheets_dispatch_timeout_invalid");
  }
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    throw new Error("company_sheets_dispatch_url_invalid");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("company_sheets_dispatch_url_invalid");
  }
  const transport = target.protocol === "https:" ? https : http;
  const payload = Buffer.from(input.body);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const succeed = (value: CompanySheetsDrainResponse) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === "" ? undefined : target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          ...input.headers,
          "content-length": String(payload.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            res.destroy();
            fail(new Error("company_sheets_dispatch_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          succeed({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", (err) => fail(err));
      }
    );
    timer = setTimeout(() => {
      req.destroy(new CompanySheetsDrainTimeoutError());
    }, input.timeoutMs);
    timer.unref();
    req.on("error", (err) => {
      if (err instanceof CompanySheetsDrainTimeoutError || err.name === "CompanySheetsDrainTimeoutError") {
        fail(new CompanySheetsDrainTimeoutError());
        return;
      }
      fail(err);
    });
    req.end(payload);
  });
}
