import { prisma } from "../../lib/db.js";
import {
  buildFrontOfficeSummary,
  type FrontOfficeSummaryServiceDeps,
} from "./front-office-summary.service.js";
import { buildFrontOfficeTrustCenter } from "./front-office-trust.service.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
} from "../lead-delivery/lead-delivery-read.service.js";
import type { FrontOfficeDemoReadinessResponse } from "./front-office.types.js";

export type FrontOfficeDemoReadinessDeps = FrontOfficeSummaryServiceDeps & {
  getLeadDeliveryReadModelByIdImpl?: typeof getLeadDeliveryReadModelById;
};

export async function buildFrontOfficeDemoReadiness(
  deps: FrontOfficeDemoReadinessDeps = {}
): Promise<FrontOfficeDemoReadinessResponse> {
  const now = new Date().toISOString();
  const notes: string[] = [];
  let leadDeliveryEndpointHealthy = false;
  let trustEndpointHealthy = false;
  let summaryEndpointHealthy = false;
  let sourceLeadsPresent = false;
  let latestTimelineAvailable = false;

  try {
    const list = deps.listLeadDeliveryReadModelImpl ?? listLeadDeliveryReadModel;
    const { items } = await list({ limit: 5 }, deps);
    leadDeliveryEndpointHealthy = true;
    sourceLeadsPresent = items.length > 0;
    if (!sourceLeadsPresent) notes.push("No source lead rows in unified read model yet.");
  } catch (e) {
    notes.push(`Lead delivery read model error: ${e instanceof Error ? e.message : "unknown"}`);
  }

  try {
    await buildFrontOfficeTrustCenter(undefined, deps);
    trustEndpointHealthy = true;
  } catch (e) {
    notes.push(`Trust center build error: ${e instanceof Error ? e.message : "unknown"}`);
  }

  try {
    await buildFrontOfficeSummary(undefined, "admin", deps);
    summaryEndpointHealthy = true;
  } catch (e) {
    notes.push(`Summary build error: ${e instanceof Error ? e.message : "unknown"}`);
  }

  if (sourceLeadsPresent) {
    try {
      const list = deps.listLeadDeliveryReadModelImpl ?? listLeadDeliveryReadModel;
      const getById = deps.getLeadDeliveryReadModelByIdImpl ?? getLeadDeliveryReadModelById;
      const { items } = await list({ limit: 1 }, deps);
      const first = items[0];
      if (first) {
        const detail = await getById(first.sourceLead.id, deps);
        latestTimelineAvailable = Boolean(detail?.timeline?.timeline.length);
        if (!latestTimelineAvailable) {
          notes.push("Latest lead has no correlated lifecycle timeline yet.");
        }
      }
    } catch {
      notes.push("Could not verify lifecycle timeline for latest lead.");
    }
  }

  const sourceCount = await prisma.sourceLeadEvent.count().catch(() => 0);
  if (sourceCount > 0 && !sourceLeadsPresent) {
    sourceLeadsPresent = true;
    notes.push("Source leads exist in database but unified list returned empty (check filters).");
  }

  return {
    ok: true,
    generatedAt: now,
    adminApiConfigured: true,
    leadDeliveryEndpointHealthy,
    trustEndpointHealthy,
    summaryEndpointHealthy,
    sourceLeadsPresent,
    latestTimelineAvailable,
    notes,
  };
}
