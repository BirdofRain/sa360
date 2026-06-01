import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const CLIENT_PORTAL_KEY_HEADER = "x-sa360-client-portal-key";

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function getClientPortalApiKey(): string | undefined {
  return process.env.CLIENT_PORTAL_API_KEY?.trim() || undefined;
}

export type ClientPortalTenantConfig = {
  clientAccountId: string;
  subaccountIdGhl?: string;
};

/** Tenant scope from env only — never from browser query in Phase 2. */
export function getClientPortalTenantConfig(): ClientPortalTenantConfig | null {
  const clientAccountId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  if (!clientAccountId) return null;
  const subaccountIdGhl = process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL?.trim();
  return {
    clientAccountId,
    ...(subaccountIdGhl ? { subaccountIdGhl } : {}),
  };
}

export function isClientPortalApiEnabled(): boolean {
  return Boolean(getClientPortalApiKey());
}

export async function verifyClientPortalApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const expected = getClientPortalApiKey();
  if (!expected) {
    await reply.status(503).send({
      ok: false,
      error: "Client portal API disabled",
      hint: "Set CLIENT_PORTAL_API_KEY and CLIENT_PORTAL_CLIENT_ACCOUNT_ID on the API.",
    });
    return false;
  }

  const raw = request.headers[CLIENT_PORTAL_KEY_HEADER.toLowerCase()];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  const headerVal = typeof provided === "string" ? provided.trim() : "";

  if (!headerVal || !timingSafeStringEqual(headerVal, expected)) {
    await reply.status(401).send({ ok: false, error: "Unauthorized" });
    return false;
  }

  return true;
}
