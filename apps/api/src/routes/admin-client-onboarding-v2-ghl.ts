/**
 * Admin onboarding routes for GHL notes v2 and Select Time Zone discovery.
 *
 * Not mounted from app.ts in this PR. Discovery and destination writes are
 * injected. The default wiring performs no GoHighLevel call and does not
 * update ClientGhlDestination.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import {
  buildOnboardingLeadNote,
  type OnboardingStoredLeadEvent,
} from "../services/ghl-delivery-adapter/onboarding-lead-note.js";
import {
  ONBOARDING_GHL_INTEGRATION_REMAINING,
  applySelectTimeZoneSelection,
  matchSelectTimeZoneWorkflows,
  validateSelectTimeZoneSelection,
  type ClientGhlDestinationSnapshot,
  type DiscoveredWorkflow,
  type SelectTimeZoneSelectionPatch,
} from "../services/client-onboarding-v2/onboarding-ghl-workflow.js";

const CLIENT_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isOnboardingV2ConfigEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED === "true";
}

export type OnboardingGhlRouteDeps = {
  /** Fresh read of workflows already discovered for this client. No live call. */
  listWorkflows?: (clientAccountId: string) => Promise<{
    clientFound: boolean;
    workflows: DiscoveredWorkflow[];
  }>;
  readDestination?: (clientAccountId: string) => Promise<ClientGhlDestinationSnapshot | null>;
  /**
   * Optional integration port. Unset until the existing ClientGhlDestination
   * row is updated with SelectTimeZoneSelectionPatch. This module does not
   * call Prisma.
   */
  saveWorkflowSelection?: (
    clientAccountId: string,
    patch: SelectTimeZoneSelectionPatch
  ) => Promise<ClientGhlDestinationSnapshot>;
};

export type OnboardingGhlRouteOptions = {
  deps?: OnboardingGhlRouteDeps;
};

const workflowPutSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    discoveredWorkflowId: z.string().trim().min(1),
    discoveredName: z.string().trim().min(1),
    clientAccountId: z.string().optional(),
  })
  .strict();

const notePreviewSchema = z
  .object({
    clientAccountId: z.string().optional(),
    testRunId: z.string().min(1).nullable().optional(),
    noteOverflow: z.enum(["refuse", "split_continuation"]).optional(),
    maxChars: z.number().int().positive().optional(),
    event: z
      .object({
        sourceLeadEventId: z.string().min(1),
      })
      .passthrough(),
  })
  .strict();

function headerPresent(request: FastifyRequest, name: string): boolean {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.some((value) => value.trim().length > 0);
  return typeof raw === "string" && raw.trim().length > 0;
}

function fail(
  reply: FastifyReply,
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return reply.status(status).send({ ok: false, error, ...extra });
}

export const adminClientOnboardingV2GhlRoutes: FastifyPluginAsync<OnboardingGhlRouteOptions> = async (
  app,
  opts
) => {
  const deps = opts.deps ?? {};

  app.get("/clients/:clientAccountId/onboarding/ghl-workflows", async (request, reply) => {
    if (!isOnboardingV2ConfigEnabled()) {
      return fail(reply, 404, "onboarding_config_disabled");
    }
    if (portalOrWorkspace(request)) return fail(reply, 403, "tenant_mismatch");
    if (!(await verifyAdminApiKey(request, reply))) return;

    const clientAccountId = pathClient(request);
    if (!clientAccountId) return fail(reply, 404, "client_not_found");
    const discovered = await readDiscovery(deps, clientAccountId);
    if (!discovered) {
      return fail(reply, 404, "workflow_not_found", {
        workflowMatch: "workflow_not_found",
        discoveryWired: false,
        selectedWorkflowId: null,
        createdWorkflow: false,
        createdCustomField: false,
      });
    }
    if (!discovered.clientFound) return fail(reply, 404, "client_not_found");

    const match = matchSelectTimeZoneWorkflows(discovered.workflows);
    if (match.workflowMatch === "unique") {
      return reply.send({
        ok: true,
        workflowMatch: "unique",
        workflowId: match.workflowId,
        workflowName: match.workflowName,
        selectedWorkflowId: match.selectedWorkflowId,
        matches: match.matches,
        discoveryWired: true,
        createdWorkflow: false,
        createdCustomField: false,
      });
    }
    const status = match.error === "workflow_ambiguous" ? 409 : 404;
    return fail(reply, status, match.error, {
      workflowMatch: match.workflowMatch,
      matches: match.matches,
      selectedWorkflowId: null,
      discoveryWired: true,
      createdWorkflow: false,
      createdCustomField: false,
    });
  });

  app.put("/clients/:clientAccountId/onboarding/ghl-workflow", async (request, reply) => {
    if (!isOnboardingV2ConfigEnabled()) {
      return fail(reply, 404, "onboarding_config_disabled");
    }
    if (portalOrWorkspace(request)) return fail(reply, 403, "tenant_mismatch");
    if (!(await verifyAdminApiKey(request, reply))) return;

    const clientAccountId = pathClient(request);
    if (!clientAccountId) return fail(reply, 404, "client_not_found");
    const parsed = workflowPutSchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, 400, "invalid_body");
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return fail(reply, 400, "client_account_mismatch");
    }

    const discovered = await readDiscovery(deps, clientAccountId);
    if (!discovered) {
      return fail(reply, 404, "workflow_not_found", { discoveryWired: false, persisted: false });
    }
    if (!discovered.clientFound) return fail(reply, 404, "client_not_found");

    const destination = deps.readDestination ? await deps.readDestination(clientAccountId) : null;
    if (destination && destination.clientAccountId !== clientAccountId) {
      return fail(reply, 400, "client_account_mismatch");
    }

    const selection = validateSelectTimeZoneSelection({
      clientAccountId,
      expectedRevision: parsed.data.expectedRevision,
      destination,
      workflows: discovered.workflows,
      discoveredWorkflowId: parsed.data.discoveredWorkflowId,
      discoveredName: parsed.data.discoveredName,
    });
    if (!selection.ok) {
      const status =
        selection.error === "workflow_not_found"
          ? 404
          : selection.error === "client_account_mismatch"
            ? 400
            : 409;
      return fail(reply, status, selection.error, {
        persisted: false,
        selectedWorkflowId: null,
        matches: selection.matches ?? [],
        createdWorkflow: false,
        createdCustomField: false,
      });
    }

    const canPersist = Boolean(deps.saveWorkflowSelection && destination);
    const saved = canPersist
      ? await deps.saveWorkflowSelection!(clientAccountId, selection.patch)
      : null;
    const next = saved ?? (destination ? applySelectTimeZoneSelection(destination, selection.patch) : null);

    return reply.send({
      ok: true,
      persisted: Boolean(saved),
      workflowMatch: "unique",
      workflowId: selection.workflowId,
      workflowName: selection.workflowName,
      selection: selection.patch,
      preserved: selection.preserved,
      destination: next
        ? {
            clientAccountId: next.clientAccountId,
            destinationWorkflowIdGhl: next.destinationWorkflowIdGhl,
            workflowTriggerMode: next.workflowTriggerMode,
            deliveryEnabled: next.deliveryEnabled,
            clientCutoverApproved: next.clientCutoverApproved,
          }
        : null,
      integration: saved ? null : "pending_client_ghl_destination_write",
      integrationRemaining: saved ? [] : ONBOARDING_GHL_INTEGRATION_REMAINING,
      createdWorkflow: false,
      createdCustomField: false,
    });
  });

  app.post("/clients/:clientAccountId/onboarding/ghl-note-preview", async (request, reply) => {
    if (!isOnboardingV2ConfigEnabled()) {
      return fail(reply, 404, "onboarding_config_disabled");
    }
    if (portalOrWorkspace(request)) return fail(reply, 403, "tenant_mismatch");
    if (!(await verifyAdminApiKey(request, reply))) return;

    const clientAccountId = pathClient(request);
    if (!clientAccountId) return fail(reply, 404, "client_not_found");
    const parsed = notePreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, 400, "invalid_body");
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return fail(reply, 400, "client_account_mismatch");
    }

    const event = parsed.data.event as unknown as OnboardingStoredLeadEvent;
    const plan = buildOnboardingLeadNote({
      event,
      clientAccountId,
      testRunId: parsed.data.testRunId ?? null,
      noteOverflow: parsed.data.noteOverflow,
      maxChars: parsed.data.maxChars,
    });
    if (!plan.ok) return fail(reply, 400, plan.error, { posted: false });

    return reply.send({
      ok: true,
      posted: false,
      externalCalls: { ghl: false, providerWebhook: false, sheets: false },
      note: plan,
    });
  });
};

function portalOrWorkspace(request: FastifyRequest): boolean {
  return headerPresent(request, CLIENT_PORTAL_KEY_HEADER) || headerPresent(request, WORKSPACE_KEY_HEADER);
}

function pathClient(request: FastifyRequest): string | null {
  const params = request.params as { clientAccountId?: string };
  const clientAccountId = params.clientAccountId?.trim() ?? "";
  if (!CLIENT_ACCOUNT_ID.test(clientAccountId)) return null;
  return clientAccountId;
}

async function readDiscovery(
  deps: OnboardingGhlRouteDeps,
  clientAccountId: string
): Promise<{ clientFound: boolean; workflows: DiscoveredWorkflow[] } | null> {
  if (!deps.listWorkflows) return null;
  return deps.listWorkflows(clientAccountId);
}
