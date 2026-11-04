import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import {
  importMetaFormCandidates,
  isMetaCaptureInventoryEnabled,
  loadMetaCaptureHealth,
  loadMetaCaptureInventory,
  parseMetaCandidateRegistry,
  type MetaCaptureHealth,
} from "../services/source-intake/meta-capture-inventory.service.js";
import {
  addMetaPageGrant,
  createMetaPageCredential,
  rotateMetaPageCredential,
  updateMetaPageGrant,
  type CredentialWriteResult,
} from "../services/source-intake/meta-page-token.service.js";

const pageGrantSchema = z.object({
  pageId: z.string().trim().min(1),
  pageName: z.string().trim().max(200).nullable().optional(),
  captureEnabled: z.boolean().optional(),
});

const createSchema = z.object({
  kind: z.enum(["page_access_token", "system_user"]),
  label: z.string().trim().min(1).max(120),
  accessToken: z.string().trim().min(20).max(4096),
  appId: z.string().trim().regex(/^[0-9]{5,32}$/).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(40).optional(),
  pages: z.array(pageGrantSchema).min(1).max(50),
});

const rotateSchema = z.object({
  accessToken: z.string().trim().min(20).max(4096),
  appId: z.string().trim().regex(/^[0-9]{5,32}$/).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(40).optional(),
});

const updatePageSchema = z
  .object({
    captureEnabled: z.boolean().optional(),
    credentialId: z.string().trim().min(1).optional(),
    pageName: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => value.captureEnabled !== undefined || value.credentialId !== undefined || value.pageName !== undefined, {
    message: "empty_patch",
  });

const idParams = z.object({ credentialId: z.string().trim().min(1) });
const pageParams = z.object({ pageId: z.string().trim().min(1) });

export type AdminMetaCaptureRoutesOptions = {
  loadHealthImpl?: () => Promise<MetaCaptureHealth>;
  createCredentialImpl?: typeof createMetaPageCredential;
  rotateCredentialImpl?: typeof rotateMetaPageCredential;
  addPageImpl?: typeof addMetaPageGrant;
  updatePageImpl?: typeof updateMetaPageGrant;
  importCandidatesImpl?: typeof importMetaFormCandidates;
  loadInventoryImpl?: typeof loadMetaCaptureInventory;
  inventoryEnabledImpl?: () => boolean;
};

function writeStatus(result: Extract<CredentialWriteResult, { ok: false }>): number {
  if (result.error === "encryption_not_configured") return 503;
  if (result.error === "not_found") return 404;
  if (result.error === "page_grant_exists") return 409;
  return 400;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

function expiresAtOf(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

/**
 * Admin-only multi-Page Meta capture controls.
 * Responses never include access tokens or ciphertext. Creating a credential
 * does not enable global intake, and enabling a Page grant does not enable
 * routing or delivery.
 */
export const adminMetaCaptureRoutes: FastifyPluginAsync<AdminMetaCaptureRoutesOptions> = async (app, opts) => {
  const loadHealth = opts.loadHealthImpl ?? loadMetaCaptureHealth;
  const createCredential = opts.createCredentialImpl ?? createMetaPageCredential;
  const rotateCredential = opts.rotateCredentialImpl ?? rotateMetaPageCredential;
  const addPage = opts.addPageImpl ?? addMetaPageGrant;
  const updatePage = opts.updatePageImpl ?? updateMetaPageGrant;
  const importCandidates = opts.importCandidatesImpl ?? importMetaFormCandidates;
  const loadInventory = opts.loadInventoryImpl ?? loadMetaCaptureInventory;
  const inventoryEnabled = opts.inventoryEnabledImpl ?? isMetaCaptureInventoryEnabled;

  app.get("/meta-capture/health", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const health = await loadHealth();
    return reply.send({ ok: true, ...health });
  });

  app.get("/meta-capture/inventory", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z
      .object({
        live: z.enum(["0", "1"]).optional(),
        credentialId: z.string().trim().min(1).optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.status(400).send({ ok: false, error: "invalid_query" });
    const live = query.data.live === "1";
    if (live && !inventoryEnabled()) {
      return reply.status(409).send({
        ok: false,
        error: "inventory_disabled",
        hint: "Set SA360_META_CAPTURE_INVENTORY_ENABLED=true before live Graph discovery. Stored reconciliation does not need that flag.",
      });
    }
    if (live && !query.data.credentialId) {
      return reply.status(400).send({ ok: false, error: "credential_required" });
    }
    const inventory = await loadInventory(live ? { liveCredentialId: query.data.credentialId } : {});
    return reply.send(inventory);
  });

  app.post("/meta-capture/credentials", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = createSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const result = await createCredential({
      kind: body.data.kind,
      label: body.data.label,
      accessToken: body.data.accessToken,
      appId: body.data.appId,
      expiresAt: expiresAtOf(body.data.expiresAt),
      scopes: body.data.scopes,
      pages: body.data.pages,
    });
    if (!result.ok) return reply.status(writeStatus(result)).send({ ok: false, error: result.error });
    logger.info("meta_capture.credential_stored", {
      credentialId: result.credential.id,
      fingerprint: result.credential.tokenFingerprint,
      pages: result.credential.pages.map((page) => page.pageId),
      captureEnabled: result.credential.pages.map((page) => page.captureEnabled),
    });
    return reply.status(201).send({ ok: true, credential: result.credential });
  });

  app.post("/meta-capture/credentials/:credentialId/rotate", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = rotateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const result = await rotateCredential({
      credentialId: params.data.credentialId,
      accessToken: body.data.accessToken,
      appId: body.data.appId,
      expiresAt: expiresAtOf(body.data.expiresAt),
      scopes: body.data.scopes,
    });
    if (!result.ok) return reply.status(writeStatus(result)).send({ ok: false, error: result.error });
    logger.info("meta_capture.credential_rotated", {
      credentialId: result.credential.id,
      fingerprint: result.credential.tokenFingerprint,
      tokenVersion: result.credential.tokenVersion,
    });
    return reply.send({ ok: true, credential: result.credential });
  });

  app.post("/meta-capture/credentials/:credentialId/pages", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = idParams.safeParse(request.params);
    const body = pageGrantSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const result = await addPage({
      credentialId: params.data.credentialId,
      pageId: body.data.pageId,
      pageName: body.data.pageName,
      captureEnabled: body.data.captureEnabled,
    });
    if (!result.ok) return reply.status(writeStatus(result)).send({ ok: false, error: result.error });
    return reply.status(201).send({ ok: true, credential: result.credential });
  });

  app.patch("/meta-capture/pages/:pageId", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = pageParams.safeParse(request.params);
    const body = updatePageSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ ok: false, error: "invalid_body" });
    const result = await updatePage({
      pageId: params.data.pageId,
      captureEnabled: body.data.captureEnabled,
      credentialId: body.data.credentialId,
      pageName: body.data.pageName,
    });
    if (!result.ok) return reply.status(writeStatus(result)).send({ ok: false, error: result.error });
    logger.info("meta_capture.page_grant_updated", {
      pageId: params.data.pageId,
      captureEnabled: body.data.captureEnabled ?? null,
      credentialId: result.credential.id,
    });
    return reply.send({ ok: true, credential: result.credential });
  });

  app.post("/meta-capture/candidates", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = parseMetaCandidateRegistry(
      request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {}
    );
    if (!parsed.ok) return reply.status(400).send({ ok: false, error: parsed.error });
    const result = await importCandidates({ sourceLabel: parsed.sourceLabel, rows: parsed.rows });
    logger.info("meta_capture.candidates_imported", {
      sourceLabel: result.sourceLabel,
      imported: result.imported,
      updated: result.updated,
    });
    return reply.send(result);
  });
};
