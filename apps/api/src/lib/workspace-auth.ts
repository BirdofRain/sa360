import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/** Header checked for Agent Workspace API (embedded UI); must match `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET`. */
export const WORKSPACE_KEY_HEADER = "x-sa360-workspace-key";

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

export function getAgentWorkspaceApiKey(): string | undefined {
  const a = process.env.AGENT_WORKSPACE_API_KEY?.trim();
  if (a) return a;
  /** DigitalOcean / ops naming alias for the same secret as `AGENT_WORKSPACE_API_KEY`. */
  const b = process.env.SA360_WORKSPACE_SECRET?.trim();
  return b || undefined;
}

/**
 * Returns false after sending 503/401. Caller must `return` immediately when false.
 */
export async function verifyAgentWorkspaceApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const expected = getAgentWorkspaceApiKey();
  if (!expected) {
    await reply.status(503).send({
      ok: false,
      error: "Agent Workspace API disabled",
      hint: "Set AGENT_WORKSPACE_API_KEY or SA360_WORKSPACE_SECRET in the API environment.",
    });
    return false;
  }

  const raw = request.headers[WORKSPACE_KEY_HEADER.toLowerCase()];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  const headerVal = typeof provided === "string" ? provided.trim() : "";

  if (!headerVal || !timingSafeStringEqual(headerVal, expected)) {
    await reply.status(401).send({ ok: false, error: "Unauthorized" });
    return false;
  }

  return true;
}
