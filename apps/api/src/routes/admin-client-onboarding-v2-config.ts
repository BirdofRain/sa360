/**
 * Onboarding destination profile, exact-v3 test worksheet approval, and
 * non-operational activation intents.
 * Mounted once from app.ts. The default worksheet reader does not call Google.
 * POST .../onboarding/activate stays disabled.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { isOnboardingConfigEnabled } from "../services/client-onboarding-v2/captured-test-delivery.js";
import {
  approveExactV3TestWorksheet,
  recordActivationIntent,
  saveOnboardingDestinationProfile,
  type WorksheetHeaderRead,
} from "../services/client-onboarding-v2/onboarding-config.service.js";
import {
  createColumnMapDraft,
  listColumnMaps,
  patchColumnMap,
  publishColumnMap,
  readExistingWorksheetSnapshot,
  retireColumnMap,
  saveExistingSheetsTarget,
  type ExistingWorksheetSnapshot,
} from "../services/client-onboarding-v2/column-maps.js";

export type OnboardingConfigRouteOptions = {
  env?: NodeJS.ProcessEnv;
  readWorksheetHeader?: (clientAccountId: string) => Promise<WorksheetHeaderRead | null>;
  readExistingWorksheet?: (
    clientAccountId: string,
    spreadsheetId: string,
    worksheetId: number
  ) => Promise<{ ok: true; snapshot: ExistingWorksheetSnapshot } | { ok: false; statusCode: number; error: string; detail?: string }>;
};

const destinationSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    sheetsSelected: z.boolean(),
    ghlMode: z.enum(["unset", "location_api", "inbound_webhook", "external_zapier"]),
    notesEnabled: z.boolean(),
    clientAccountId: z.string().optional(),
  })
  .strict();

const worksheetSchema = z
  .object({
    requestId: z.string().uuid(),
    clientAccountId: z.string().optional(),
  })
  .strict();

const targetSchema = z
  .object({
    requestId: z.string().uuid(),
    spreadsheetId: z.string().min(1).max(300),
    worksheetId: z.number().int().nonnegative(),
    clientAccountId: z.string().optional(),
  })
  .strict();

const columnMapCreateSchema = z
  .object({
    requestId: z.string().uuid(),
    spreadsheetId: z.string().min(1).max(300),
    worksheetId: z.number().int().nonnegative(),
    sourceScope: z.string().min(1).max(160),
    baseSchemaVersion: z.string().min(1).max(80),
    clientAccountId: z.string().optional(),
  })
  .strict();

const columnMapPatchSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    assignments: z.array(z.unknown()).max(80),
    clientAccountId: z.string().optional(),
  })
  .strict();

const columnMapPublishSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    clientAccountId: z.string().optional(),
  })
  .strict();

const columnMapRetireSchema = z
  .object({
    requestId: z.string().uuid(),
    clientAccountId: z.string().optional(),
  })
  .strict();

const activationSchema = z
  .object({
    requestId: z.string().uuid(),
    destination: z.enum(["google_sheets_campaign", "ghl_location_api"]),
    confirmation: z.string(),
    expectedReceiptIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    clientAccountId: z.string().optional(),
  })
  .strict();

export const adminClientOnboardingV2ConfigRoutes: FastifyPluginAsync<OnboardingConfigRouteOptions> = async (
  app,
  opts
) => {
  const env = opts.env ?? process.env;
  const readHeader = opts.readWorksheetHeader ?? (async () => null);
  const readExisting = opts.readExistingWorksheet ?? readExistingWorksheetSnapshot;

  app.put("/clients/:clientAccountId/onboarding/destination", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const parsed = destinationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const saved = await saveOnboardingDestinationProfile({
      clientAccountId,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
      sheetsSelected: parsed.data.sheetsSelected,
      ghlMode: parsed.data.ghlMode,
      notesEnabled: parsed.data.notesEnabled,
      actorLabel: actorLabel(request),
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({
      revision: saved.revision,
      notesEnabled: saved.notesEnabled,
      notesContractVersion: saved.notesContractVersion,
      ghlMode: saved.ghlMode,
      sheetsSelected: saved.sheetsSelected,
      deliveryEnabled: saved.deliveryEnabled,
      campaignDispatchEnabled: saved.campaignDispatchEnabled,
      ok: true,
      deliverySwitchChanged: false,
      liveActivationPerformedByOnboarding: false,
    });
  });

  app.put("/clients/:clientAccountId/onboarding/test-worksheet", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const parsed = worksheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const saved = await approveExactV3TestWorksheet(
      { clientAccountId, requestId: parsed.data.requestId, actorLabel: actorLabel(request) },
      readHeader
    );
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({
      worksheetId: saved.worksheetId,
      schemaVersion: saved.schemaVersion,
      ok: true,
      createdWorksheet: false,
      productionBindingChanged: false,
      externalCalls: { providerWebhook: false, sheets: false, ghl: false },
    });
  });

  app.post("/clients/:clientAccountId/onboarding/activation-intent", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const parsed = activationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const saved = await recordActivationIntent({
      clientAccountId,
      requestId: parsed.data.requestId,
      destination: parsed.data.destination,
      confirmation: parsed.data.confirmation,
      expectedReceiptIds: parsed.data.expectedReceiptIds ?? [],
      actorLabel: actorLabel(request),
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({
      status: saved.status,
      activatesDelivery: saved.activatesDelivery,
      id: saved.id,
      ok: true,
      liveActivationPerformedByOnboarding: false,
      externalCalls: { providerWebhook: false, sheets: false, ghl: false },
    });
  });

  app.get("/clients/:clientAccountId/onboarding/column-maps", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const query = request.query as { worksheetId?: string };
    const worksheetId = query.worksheetId == null || query.worksheetId === "" ? null : Number(query.worksheetId);
    if (worksheetId != null && (!Number.isInteger(worksheetId) || worksheetId < 0)) {
      return reply.status(400).send({ ok: false, error: "invalid_body" });
    }
    const listed = await listColumnMaps(clientAccountId, worksheetId);
    if (!listed.ok) return reply.status(listed.statusCode).send({ ok: false, error: listed.error, detail: listed.detail });
    return reply.send({ ok: true, maps: listed.maps });
  });

  app.put("/clients/:clientAccountId/onboarding/sheets-target", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const parsed = targetSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const read = await readExisting(clientAccountId, parsed.data.spreadsheetId, parsed.data.worksheetId);
    if (!read.ok) return reply.status(read.statusCode).send({ ok: false, error: read.error, detail: read.detail });
    const saved = await saveExistingSheetsTarget({
      clientAccountId,
      requestId: parsed.data.requestId,
      actorLabel: actorLabel(request),
      snapshot: read.snapshot,
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send(saved);
  });

  app.post("/clients/:clientAccountId/onboarding/column-maps", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const parsed = columnMapCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const read = await readExisting(clientAccountId, parsed.data.spreadsheetId, parsed.data.worksheetId);
    if (!read.ok) return reply.status(read.statusCode).send({ ok: false, error: read.error, detail: read.detail });
    const saved = await createColumnMapDraft({
      clientAccountId,
      requestId: parsed.data.requestId,
      spreadsheetId: parsed.data.spreadsheetId,
      worksheetId: parsed.data.worksheetId,
      sourceScope: parsed.data.sourceScope,
      baseSchemaVersion: parsed.data.baseSchemaVersion,
      actorLabel: actorLabel(request),
      snapshot: read.snapshot,
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({ ok: true, map: saved.map, customMapping: true });
  });

  app.patch("/clients/:clientAccountId/onboarding/column-maps/:mapId", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const mapId = (request.params as { mapId: string }).mapId;
    const parsed = columnMapPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const saved = await patchColumnMap({
      clientAccountId,
      mapId,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
      assignments: parsed.data.assignments,
      actorLabel: actorLabel(request),
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({ ok: true, map: saved.map, customMapping: true });
  });

  app.post("/clients/:clientAccountId/onboarding/column-maps/:mapId/publish", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const mapId = (request.params as { mapId: string }).mapId;
    const parsed = columnMapPublishSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const current = await listColumnMaps(clientAccountId, null);
    const map = current.ok ? current.maps.find((item) => item.id === mapId) : null;
    if (!current.ok) return reply.status(current.statusCode).send({ ok: false, error: current.error, detail: current.detail });
    if (!map) return reply.status(404).send({ ok: false, error: "client_not_found", detail: "Column map not found for this client." });
    const read = await readExisting(clientAccountId, map.spreadsheetId, map.worksheetId);
    if (!read.ok) return reply.status(read.statusCode).send({ ok: false, error: read.error, detail: read.detail });
    const saved = await publishColumnMap({
      clientAccountId,
      mapId,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
      actorLabel: actorLabel(request),
      snapshot: read.snapshot,
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({ ok: true, map: saved.map, schemaRebound: saved.schemaRebound, headerRewritten: false, customMapping: true });
  });

  app.post("/clients/:clientAccountId/onboarding/column-maps/:mapId/retire", async (request, reply) => {
    if (!(await authorize(request, reply, env))) return;
    const clientAccountId = pathClient(request);
    const mapId = (request.params as { mapId: string }).mapId;
    const parsed = columnMapRetireSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    if (parsed.data.clientAccountId && parsed.data.clientAccountId !== clientAccountId) {
      return reply.status(400).send({ ok: false, error: "client_account_mismatch" });
    }
    const saved = await retireColumnMap({
      clientAccountId,
      mapId,
      requestId: parsed.data.requestId,
      actorLabel: actorLabel(request),
    });
    if (!saved.ok) return reply.status(saved.statusCode).send({ ok: false, error: saved.error, detail: saved.detail });
    return reply.send({ ok: true, map: saved.map, headerRewritten: false, customMapping: true });
  });

  app.post("/clients/:clientAccountId/onboarding/activate", async (request, reply) => {
    if (foreignCredential(request)) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!(await verifyAdminApiKey(request, reply))) return;
    return reply.status(404).send({
      ok: false,
      error: "activation_disabled",
      liveActivationPerformedByOnboarding: false,
    });
  });
};

async function authorize(request: FastifyRequest, reply: FastifyReply, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (foreignCredential(request)) {
    await reply.status(403).send({ ok: false, error: "forbidden" });
    return false;
  }
  if (!(await verifyAdminApiKey(request, reply))) return false;
  if (!isOnboardingConfigEnabled(env)) {
    await reply.status(404).send({ ok: false, error: "onboarding_config_disabled" });
    return false;
  }
  return true;
}

function foreignCredential(request: FastifyRequest): boolean {
  return [CLIENT_PORTAL_KEY_HEADER, CLIENT_PORTAL_ASSERTION_HEADER, WORKSPACE_KEY_HEADER].some((name) => {
    const raw = request.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function pathClient(request: FastifyRequest): string {
  return (request.params as { clientAccountId: string }).clientAccountId;
}

function actorLabel(request: FastifyRequest): string | null {
  const raw = request.headers["x-sa360-admin-actor"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}
