import { randomUUID } from "node:crypto";

export function readRequestId(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const raw = request.headers["x-request-id"];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return randomUUID();
}
