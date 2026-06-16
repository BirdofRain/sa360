import type { FastifyInstance } from "fastify";

const DEFAULT_MAX_FIELDS = 500;
const DEFAULT_MAX_FIELD_VALUE_LENGTH = 16_384;

function trimFieldValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > DEFAULT_MAX_FIELD_VALUE_LENGTH) {
    throw new Error("field_value_too_large");
  }
  return trimmed;
}

/** Parse application/x-www-form-urlencoded bodies (+ decoded as space). */
export function parseUrlEncodedFormBody(
  body: string,
  opts?: { maxFields?: number }
): Record<string, unknown> {
  const maxFields = opts?.maxFields ?? DEFAULT_MAX_FIELDS;
  const params = new URLSearchParams(body);
  const keys = [...new Set(params.keys())];
  if (keys.length > maxFields) {
    throw new Error("too_many_fields");
  }

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const values = params.getAll(key).map(trimFieldValue);
    if (values.length === 0) continue;
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}

function parseMultipartDisposition(header: string): { name?: string; filename?: string } {
  const nameMatch = /name="([^"]+)"/i.exec(header);
  const fileMatch = /filename="([^"]*)"/i.exec(header);
  return {
    name: nameMatch?.[1],
    filename: fileMatch?.[1],
  };
}

/** Parse simple multipart/form-data field parts (file parts stored as filename only). */
export function parseMultipartFormBody(
  body: Buffer,
  contentType: string,
  opts?: { maxFields?: number }
): Record<string, unknown> {
  const maxFields = opts?.maxFields ?? DEFAULT_MAX_FIELDS;
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error("multipart_boundary_missing");
  }

  const text = body.toString("utf8");
  const delimiter = `--${boundary}`;
  const parts = text.split(delimiter).slice(1, -1);
  if (parts.length > maxFields) {
    throw new Error("too_many_fields");
  }

  const result: Record<string, unknown> = {};
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerBlock = trimmed.slice(0, headerEnd);
    const valueBlock = trimmed.slice(headerEnd + 4).replace(/\r\n$/, "");
    const disposition = parseMultipartDisposition(headerBlock);
    if (!disposition.name) continue;

    if (disposition.filename) {
      result[disposition.name] = disposition.filename;
      continue;
    }

    const value = trimFieldValue(valueBlock);
    const existing = result[disposition.name];
    if (existing === undefined) {
      result[disposition.name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[disposition.name] = [existing, value];
    }
  }

  return result;
}

export function parseLeadCaptureWebhookBody(
  body: unknown,
  contentType: string | undefined
): Record<string, unknown> | null {
  if (body === null || body === undefined) return null;

  const normalizedType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (normalizedType === "application/json" || normalizedType === "" || normalizedType === "text/plain") {
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  }

  if (normalizedType === "application/x-www-form-urlencoded") {
    if (typeof body !== "string") return null;
    return parseUrlEncodedFormBody(body);
  }

  if (normalizedType === "multipart/form-data") {
    if (!Buffer.isBuffer(body)) return null;
    return parseMultipartFormBody(body, contentType ?? "");
  }

  return null;
}

export function stripLeadCaptureInternalMetadata(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...raw };
  delete copy._sa360_intake_format;
  delete copy._sa360_intake_content_type;
  return copy;
}

export function registerLeadCaptureWebhookBodyParsers(
  app: FastifyInstance,
  bodyLimit = 1_048_576
): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit },
    (_req: unknown, body: string, done: (err: Error | null, result?: unknown) => void) => {
      try {
        done(null, body);
      } catch (err) {
        done(err instanceof Error ? err : new Error("invalid_form_body"));
      }
    }
  );

  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit },
    (_req: unknown, body: Buffer, done: (err: Error | null, result?: unknown) => void) => {
      try {
        done(null, body);
      } catch (err) {
        done(err instanceof Error ? err : new Error("invalid_multipart_body"));
      }
    }
  );
}
