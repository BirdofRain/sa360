import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const ADMIN_KEY_HEADER = "x-sa360-admin-key";

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) {
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function getAdminApiKey(): string | undefined {
  const v = process.env.ADMIN_API_KEY?.trim();
  return v || undefined;
}

/**
 * Returns false after sending 503/401. Caller must `return` immediately when false.
 */
export async function verifyAdminApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const expected = getAdminApiKey();
  if (!expected) {
    await reply.status(503).send({
      ok: false,
      error: "Admin API disabled",
      hint: "Set ADMIN_API_KEY in the API environment.",
    });
    return false;
  }

  const raw = request.headers[ADMIN_KEY_HEADER.toLowerCase()];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  const headerVal = typeof provided === "string" ? provided.trim() : "";

  if (!headerVal || !timingSafeStringEqual(headerVal, expected)) {
    await reply.status(401).send({ ok: false, error: "Unauthorized" });
    return false;
  }

  return true;
}
