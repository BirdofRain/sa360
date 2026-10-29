import type { FastifyInstance } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  listAssociationDispatchVisibility,
  processDueGhlAssociationDispatchesFromDb,
  type AssociationDispatchVisibility,
} from "../services/ghl-association-dispatch/ghl-association-dispatch.js";

type AssociationDispatchRouteOpts = {
  prefix?: string;
  list?: () => Promise<AssociationDispatchVisibility>;
  drain?: typeof processDueGhlAssociationDispatchesFromDb;
};

export async function adminGhlAssociationDispatchRoutes(
  app: FastifyInstance,
  opts: AssociationDispatchRouteOpts = {}
) {
  const list = opts.list ?? listAssociationDispatchVisibility;
  const drain = opts.drain ?? processDueGhlAssociationDispatchesFromDb;

  app.get("/ghl/association-dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const visibility = await list();
    return reply.send({ ok: true, ...visibility });
  });

  app.post("/ghl/internal/process-association-dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const result = await drain();
    return reply.send({ ok: true, ...result });
  });
}
