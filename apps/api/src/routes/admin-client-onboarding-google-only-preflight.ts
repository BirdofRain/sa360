import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import {
  decideGoogleOnlyPilot,
  readGoogleOnlyPilotPreflight,
  type GoogleOnlyPilotPreflight,
} from "../services/client-onboarding-v2/google-only-pilot-preflight.js";

/**
 * Read-only Google-only pilot preflight.
 * Admin API key only. Portal, workspace, and observer credentials are rejected.
 * The body accepts no SQL. The response contains no credentials and no lead PII.
 */

export type GoogleOnlyPreflightRouteOptions = {
  verifyAdmin?: typeof verifyAdminApiKey;
  readPreflight?: (clientAccountId: string) => Promise<GoogleOnlyPilotPreflight>;
};

const NO_CALLS = { providerWebhook: false as const, sheets: false as const, ghl: false as const };

export const adminClientOnboardingGoogleOnlyPreflightRoutes: FastifyPluginAsync<GoogleOnlyPreflightRouteOptions> = async (
  app,
  opts
) => {
  const verify = opts.verifyAdmin ?? verifyAdminApiKey;
  const readPreflight = opts.readPreflight ?? ((clientAccountId: string) => readGoogleOnlyPilotPreflight(clientAccountId));

  app.get("/clients/:clientAccountId/onboarding/google-only-pilot/preflight", async (request, reply) => {
    if (foreignCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden", externalCalls: NO_CALLS });
    if (!(await verify(request, reply))) return;
    const clientAccountId = (request.params as { clientAccountId?: string }).clientAccountId?.trim() ?? "";
    if (!clientAccountId || clientAccountId.length > 120 || /[\s'"]/.test(clientAccountId)) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch", externalCalls: NO_CALLS });
    }
    const report = await readPreflight(clientAccountId);
    if (report.clientAccountId !== clientAccountId) {
      return reply.status(403).send({ ok: false, error: "tenant_mismatch", externalCalls: NO_CALLS });
    }
    return reply.send(presentPreflight(report));
  });
};

export function presentPreflight(report: GoogleOnlyPilotPreflight) {
  const decision = decideGoogleOnlyPilot(report);
  return {
    ok: true as const,
    clientAccountId: report.clientAccountId,
    writes: false as const,
    externalCalls: NO_CALLS,
    worksheet: presentState(report.worksheet, (value) => {
      const destinationId = report.dispatch.state === "read" ? report.dispatch.value?.spreadsheetId ?? null : null;
      return value
        ? {
            present: true,
            schemaVersion: value.schemaVersion,
            control: value.control,
            sameSpreadsheetAsDestination: destinationId == null ? null : value.spreadsheetId === destinationId,
          }
        : { present: false };
    }),
    identity: presentState(report.identities, (value) => ({
      present: value.length > 0,
      evidenceMethods: [...new Set(value.map((row) => row.evidenceMethod).filter((method): method is string => Boolean(method)))],
    })),
    identityConflicts: presentState(report.identityConflicts, (value) => value),
    runs: presentState(report.runs, (value) => ({
      count: value.length,
      oneShotConsumed: value.some((run) => run.warningCodes.includes("google_only_one_shot")),
      uncertainOrExecuting: value.filter((run) => run.status === "uncertain" || run.status === "executing").length,
    })),
    locks: presentState(report.locks, (value) =>
      value.map((lock) => ({
        worksheetId: lock.worksheetId,
        ownerJobId: lock.ownerJobId,
        held: Boolean(lock.ownerJobId),
      }))
    ),
    heldAppends: presentState(report.heldAppends, (value) => ({ count: value.length })),
    unresolvedJobs: presentState(report.unresolvedJobs, (value) => ({ count: value.length })),
    dispatch: presentState(report.dispatch, (value) =>
      value
        ? {
            present: true,
            campaignDispatchEnabled: value.campaignDispatchEnabled,
            agedDispatchEnabled: value.agedDispatchEnabled,
            campaignDispatchNotBefore: value.campaignDispatchNotBefore,
            agedDispatchNotBefore: value.agedDispatchNotBefore,
          }
        : { present: false }
    ),
    quarantine: presentState(report.quarantine, (value) => value),
    grants: presentState(report.grants, (value) => ({
      role: "sa360_app" as const,
      tables: value.map((grant) => ({ tableName: grant.tableName, canSelect: grant.canSelect })),
    })),
    decision,
  };
}

function presentState<T, R>(
  evidence: { state: "read"; value: T } | { state: "unavailable" | "unverified"; reason: string },
  map: (value: T) => R
): { state: "read"; value: R } | { state: "unavailable" | "unverified"; reason: string } {
  if (evidence.state !== "read") return { state: evidence.state, reason: evidence.reason };
  return { state: "read", value: map(evidence.value) };
}

function foreignCredential(request: FastifyRequest): boolean {
  if (observerCookie(request)) return true;
  return [CLIENT_PORTAL_KEY_HEADER, CLIENT_PORTAL_ASSERTION_HEADER, WORKSPACE_KEY_HEADER].some((name) => {
    const raw = request.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function observerCookie(request: FastifyRequest): boolean {
  const raw = request.headers.cookie;
  const cookie = Array.isArray(raw) ? raw.join(";") : raw ?? "";
  return /(?:^|;\s*)sa360_admin_session=observer(?:;|$)/.test(cookie);
}
