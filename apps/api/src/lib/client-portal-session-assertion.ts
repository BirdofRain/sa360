import {
  CLIENT_PORTAL_ASSERTION_HEADER,
  verifyClientPortalAssertion,
} from "@sa360/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getClientPortalApiKey, verifyClientPortalApiKey } from "./client-portal-auth.js";
import { getPortalSessionAuthState } from "../services/portal-login.service.js";

export type AuthenticatedPortalTenant = {
  clientAccountId: string;
};

export async function requireAuthenticatedPortalTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthenticatedPortalTenant | null> {
  if (!(await verifyClientPortalApiKey(request, reply))) return null;
  const raw = request.headers[CLIENT_PORTAL_ASSERTION_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  const secret = getClientPortalApiKey();
  const assertion = secret
    ? verifyClientPortalAssertion(typeof token === "string" ? token : undefined, secret)
    : null;
  if (!assertion) {
    await reply.status(401).send({ ok: false, error: "Authenticated portal session required" });
    return null;
  }
  const state = await getPortalSessionAuthState(assertion.clientAccountId);
  if (
    !state ||
    !state.portalEnabled ||
    state.portalSessionEpoch !== assertion.portalSessionEpoch
  ) {
    await reply.status(401).send({ ok: false, error: "Authenticated portal session required" });
    return null;
  }
  return { clientAccountId: state.clientAccountId };
}
