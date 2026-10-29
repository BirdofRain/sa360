import type { FastifyInstance } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { processDueGhlAssociationDispatchesFromDb } from "../services/ghl-association-dispatch/ghl-association-dispatch.js";

export async function adminGhlAssociationDispatchRoutes(app: FastifyInstance) {
  app.post("/ghl/internal/process-association-dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const result = await processDueGhlAssociationDispatchesFromDb();
    return reply.send({ ok: true, ...result });
  });
}
