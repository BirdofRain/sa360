import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { verifyClientPortalApiKey } from "../lib/client-portal-auth.js";
import {
  clientDashboardQuerySchema,
  resolveClientDashboardDateRange,
} from "../schemas/client-dashboard.schema.js";
import { portalContextQuerySchema, portalLoginBodySchema, portalSessionStateQuerySchema } from "../schemas/client-portal.schema.js";
import {
  getClientDashboard,
  type ClientDashboardResponse,
  type ClientDashboardServiceDeps,
} from "../services/client-dashboard.service.js";
import {
  getPortalClientContextByLoginEmail,
  resolveClientPortalTenant,
  type ClientPortalTenantDeps,
} from "../services/client-portal-tenant.service.js";
import {
  authenticatePortalCustomerLogin,
  getPortalSessionAuthState,
} from "../services/portal-login.service.js";
import {
  leadDeliveryIdParamSchema,
  leadDeliveryListQuerySchema,
} from "../schemas/lead-delivery.schema.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
  type LeadDeliveryReadServiceDeps,
} from "../services/lead-delivery/lead-delivery-read.service.js";
import {
  presentLeadDeliveryDetail,
  presentLeadDeliveryListRow,
} from "../services/lead-delivery/lead-delivery-present.service.js";
import type {
  LeadDeliveryDetailResponse,
  LeadDeliveryListResponse,
} from "../services/lead-delivery/lead-delivery.types.js";
import { frontOfficeQuerySchema } from "../schemas/front-office.schema.js";
import { csvAttachmentContentDisposition } from "../lib/csv-content-disposition.js";
import {
  leadOrderClientCreateBodySchema,
  leadOrderClientListQuerySchema,
  leadOrderExportIdParamSchema,
  leadOrderIdParamSchema,
  leadOrderLeadsQuerySchema,
} from "../schemas/lead-order.schema.js";
import { buildFrontOfficeSummary } from "../services/front-office/front-office-summary.service.js";
import { buildFrontOfficeTrustCenter } from "../services/front-office/front-office-trust.service.js";
import { presentTrustCenter } from "../services/front-office/front-office-trust-present.service.js";
import type { FrontOfficeSummaryServiceDeps } from "../services/front-office/front-office-summary.service.js";
import {
  presentLeadOrderDetail,
  presentLeadOrderListRow,
} from "../services/lead-order/lead-order-present.service.js";
import {
  createClientLeadOrder,
  getClientLeadOrder,
  listClientLeadOrders,
} from "../services/lead-order/lead-order.service.js";
import {
  listFulfilledLeadsForClientOrder,
  type LeadOrderFulfilledLeadsResponse,
  type LeadOrderFulfilledLeadsServiceDeps,
} from "../services/lead-order/lead-order-fulfilled-leads.service.js";
import type {
  LeadOrderAdminRow,
  LeadOrderClientRow,
  LeadOrderCreateResponse,
  LeadOrderDetailResponse,
  LeadOrderListResponse,
} from "../services/lead-order/lead-order.types.js";
import {
  getClientReleasedDelivery,
  getClientReleasedDeliveryDownload,
  listClientReleasedDeliveries,
  type LeadOrderReleasedDeliveriesServiceDeps,
} from "../services/lead-order/lead-order-released-deliveries.service.js";
import { buildClientLeadsOnDemandAvailability } from "../services/lead-inventory/lead-inventory-client-availability.service.js";

export type ClientPortalRoutesOptions = {
  tenantDeps?: ClientPortalTenantDeps;
  getClientDashboardImpl?: (
    params: {
      tenant: { clientAccountId: string; subaccountIdGhl?: string };
      range: ReturnType<typeof resolveClientDashboardDateRange>;
    },
    deps?: ClientDashboardServiceDeps
  ) => Promise<ClientDashboardResponse>;
  leadDeliveryDeps?: LeadDeliveryReadServiceDeps & {
    listLeadDeliveryReadModelImpl?: typeof listLeadDeliveryReadModel;
    getLeadDeliveryReadModelByIdImpl?: typeof getLeadDeliveryReadModelById;
  };
  frontOfficeDeps?: FrontOfficeSummaryServiceDeps & {
    buildFrontOfficeTrustCenterImpl?: typeof buildFrontOfficeTrustCenter;
    buildFrontOfficeSummaryImpl?: typeof buildFrontOfficeSummary;
  };
  leadOrderDeps?: LeadOrderFulfilledLeadsServiceDeps & LeadOrderReleasedDeliveriesServiceDeps;
};

export const clientPortalRoutes: FastifyPluginAsync<ClientPortalRoutesOptions> = async (
  app,
  opts
) => {
  const loadDashboard = opts.getClientDashboardImpl ?? getClientDashboard;
  const tenantDeps = opts.tenantDeps;
  const leadDeliveryDeps = opts.leadDeliveryDeps ?? {};
  const listRead = leadDeliveryDeps.listLeadDeliveryReadModelImpl ?? listLeadDeliveryReadModel;
  const getById = leadDeliveryDeps.getLeadDeliveryReadModelByIdImpl ?? getLeadDeliveryReadModelById;

  app.get("/lead-delivery", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = leadDeliveryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const { items, nextCursor } = await listRead(
      {
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
        clientAccountIdResolved: resolved.tenant.clientAccountId,
        matched: parsed.data.matched,
        status: parsed.data.status as never,
        sourceProvider: parsed.data.sourceProvider,
      },
      leadDeliveryDeps
    );

    const response: LeadDeliveryListResponse = {
      ok: true,
      items: items.map((ctx) => presentLeadDeliveryListRow(ctx, "client")),
      nextCursor,
    };
    return reply.send(response);
  });

  app.get("/lead-delivery/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const paramParsed = leadDeliveryIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const queryParsed = leadDeliveryListQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(queryParsed.success ? queryParsed.data.clientAccountId : undefined, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const ctx = await getById(paramParsed.data.id, leadDeliveryDeps);
    if (!ctx) {
      return reply.status(404).send({ ok: false, error: "Lead delivery record not found" });
    }

    const rowClientId =
      ctx.sourceLead.clientAccountIdResolved ?? ctx.decision?.destinationClientAccountId ?? null;
    if (rowClientId !== resolved.tenant.clientAccountId) {
      return reply.status(404).send({ ok: false, error: "Lead delivery record not found" });
    }

    const response: LeadDeliveryDetailResponse = {
      ok: true,
      item: presentLeadDeliveryDetail(ctx, "client"),
    };
    return reply.send(response);
  });

  const frontOfficeDeps = opts.frontOfficeDeps ?? {};
  const buildTrust = frontOfficeDeps.buildFrontOfficeTrustCenterImpl ?? buildFrontOfficeTrustCenter;
  const buildSummary = frontOfficeDeps.buildFrontOfficeSummaryImpl ?? buildFrontOfficeSummary;

  app.get("/trust", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = frontOfficeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const center = await buildTrust(resolved.tenant.clientAccountId, frontOfficeDeps);
    return presentTrustCenter(center, "client");
  });

  app.get("/front-office/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = frontOfficeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const summary = await buildSummary(resolved.tenant.clientAccountId, "client", frontOfficeDeps);
    return reply.send({ ok: true, ...summary });
  });

  app.get("/portal-context", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = portalContextQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const ctx = await getPortalClientContextByLoginEmail(parsed.data.loginEmail, tenantDeps);
    if (!ctx) {
      return reply.status(404).send({ ok: false, error: "Portal account not found" });
    }

    return reply.send({ ok: true, context: ctx });
  });

  app.post("/portal-login", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = portalLoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const result = await authenticatePortalCustomerLogin(
      parsed.data.loginEmail,
      parsed.data.password,
      tenantDeps
    );
    if (!result.ok) {
      const status =
        result.code === "PORTAL_DISABLED" ? 403 : result.code === "NOT_FOUND" ? 404 : 401;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }

    return reply.send({
      ok: true,
      passwordCheck: result.passwordCheck,
      portalSessionEpoch: result.portalSessionEpoch,
      context: result.context,
    });
  });

  app.get("/portal-session-state", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = portalSessionStateQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const state = await getPortalSessionAuthState(parsed.data.clientAccountId, tenantDeps);
    if (!state) {
      return reply.status(404).send({ ok: false, error: "Portal account not found" });
    }

    return reply.send({
      ok: true,
      clientAccountId: state.clientAccountId,
      portalSessionEpoch: state.portalSessionEpoch,
      portalEnabled: state.portalEnabled,
    });
  });

  app.get("/dashboard", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = clientDashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    let range;
    try {
      range = resolveClientDashboardDateRange(parsed.data);
    } catch (e) {
      const msg = e instanceof RangeError ? e.message : "Invalid date range";
      return reply.status(400).send({ ok: false, error: msg });
    }

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    return loadDashboard({ tenant: resolved.tenant, range });
  });

  const leadOrderDeps = opts.leadOrderDeps ?? {};

  app.get("/lead-orders", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = leadOrderClientListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const q = parsed.data;
    const { items, nextCursor } = await listClientLeadOrders(
      {
        limit: q.limit,
        cursor: q.cursor,
        status: q.status,
        clientAccountId: resolved.tenant.clientAccountId,
        nicheKey: q.nicheKey,
      },
      leadOrderDeps
    );

    const response: LeadOrderListResponse = {
      ok: true,
      items: items.map((row) => presentLeadOrderListRow(row, "client")) as LeadOrderClientRow[],
      nextCursor,
    };
    return reply.send(response);
  });

  app.get("/lead-orders/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const paramParsed = leadOrderIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const row = await getClientLeadOrder(
      paramParsed.data.id,
      resolved.tenant.clientAccountId,
      leadOrderDeps
    );
    if (!row) {
      return reply.status(404).send({ ok: false, error: "Lead order not found" });
    }

    const response: LeadOrderDetailResponse = {
      ok: true,
      item: presentLeadOrderDetail(row, "client") as LeadOrderClientRow,
    };
    return reply.send(response);
  });

  app.get("/lead-orders/:id/leads", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const paramParsed = leadOrderIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const queryParsed = leadOrderLeadsQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: queryParsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const result = await listFulfilledLeadsForClientOrder(
      {
        orderId: paramParsed.data.id,
        clientAccountId: resolved.tenant.clientAccountId,
        limit: queryParsed.data.limit,
        cursor: queryParsed.data.cursor,
      },
      leadOrderDeps
    );
    if (!result) {
      return reply.status(404).send({ ok: false, error: "Lead order not found" });
    }

    const response: LeadOrderFulfilledLeadsResponse = {
      ok: true,
      items: result.items,
      nextCursor: result.nextCursor,
    };
    return reply.send(response);
  });

  app.get("/lead-orders/:id/exports", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const paramParsed = leadOrderIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const result = await listClientReleasedDeliveries(
      {
        orderId: paramParsed.data.id,
        clientAccountId: resolved.tenant.clientAccountId,
      },
      leadOrderDeps
    );
    if (!result) {
      return reply.status(404).send({ ok: false, error: "Lead order not found" });
    }

    return reply.send({ ok: true, items: result.items });
  });

  app.get("/lead-orders/:id/exports/:exportId", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const paramParsed = leadOrderExportIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid id",
        details: paramParsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const item = await getClientReleasedDelivery(
      {
        orderId: paramParsed.data.id,
        exportId: paramParsed.data.exportId,
        clientAccountId: resolved.tenant.clientAccountId,
      },
      leadOrderDeps
    );
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Delivery not found" });
    }

    return reply.send({ ok: true, item });
  });

  app.get(
    "/lead-orders/:id/exports/:exportId/download",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await verifyClientPortalApiKey(request, reply))) return;

      const paramParsed = leadOrderExportIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.status(400).send({
          ok: false,
          error: "Invalid id",
          details: paramParsed.error.flatten(),
        });
      }

      const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
      const resolved = await resolveClientPortalTenant(
        tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
        tenantDeps
      );
      if ("error" in resolved) {
        const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
        return reply.status(status).send({
          ok: false,
          error: resolved.error,
          code: resolved.code,
        });
      }

      const result = await getClientReleasedDeliveryDownload(
        {
          orderId: paramParsed.data.id,
          exportId: paramParsed.data.exportId,
          clientAccountId: resolved.tenant.clientAccountId,
        },
        leadOrderDeps
      );
      if (!result) {
        return reply.status(404).send({ ok: false, error: "Delivery not found" });
      }

      reply.header("content-type", result.contentType);
      reply.header("content-disposition", csvAttachmentContentDisposition(result.filename));
      return reply.send(result.csv);
    }
  );

  app.post("/lead-orders", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = leadOrderClientCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const tenantQuery = frontOfficeQuerySchema.safeParse(request.query);
    const resolved = await resolveClientPortalTenant(
      tenantQuery.success ? tenantQuery.data.clientAccountId : undefined,
      tenantDeps
    );
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const created = await createClientLeadOrder(
      parsed.data,
      resolved.tenant.clientAccountId,
      leadOrderDeps
    );
    if (!created.ok) {
      return reply.status(409).send({
        ok: false,
        error: created.error,
        code: created.code,
      });
    }

    const response: LeadOrderCreateResponse = {
      ok: true,
      item: presentLeadOrderDetail(created.row, "client") as LeadOrderClientRow,
    };
    return reply.status(201).send(response);
  });

  app.get("/leads-on-demand/availability", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyClientPortalApiKey(request, reply))) return;

    const parsed = frontOfficeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const resolved = await resolveClientPortalTenant(parsed.data.clientAccountId, tenantDeps);
    if ("error" in resolved) {
      const status = resolved.code === "PORTAL_DISABLED" ? 403 : 404;
      return reply.status(status).send({
        ok: false,
        error: resolved.error,
        code: resolved.code,
      });
    }

    const availability = await buildClientLeadsOnDemandAvailability({
      clientAccountId: resolved.tenant.clientAccountId,
      nicheKey: parsed.data.nicheKey,
      productType: parsed.data.productType,
    });

    return reply.send({ ok: true, availability });
  });
};
