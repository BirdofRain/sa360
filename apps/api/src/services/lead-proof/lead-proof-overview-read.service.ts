import { getLeadProofOverviewSummary } from "../../repositories/lead-proof.repository.js";
import {
  presentLeadFulfillmentOverview,
  type LeadFulfillmentOverviewDto,
} from "./lead-proof-overview.present.js";

/** Backend DTO for Admin C.O.C. Lead Fulfillment Overview — ready for future API wiring. */
export async function getLeadFulfillmentOverviewForAdmin(options?: {
  recentLimit?: number;
}): Promise<LeadFulfillmentOverviewDto> {
  const summary = await getLeadProofOverviewSummary(options);
  return presentLeadFulfillmentOverview(summary);
}
