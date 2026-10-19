import "server-only";

import { adminFetchJson } from "@/lib/admin-api/server";
import {
  provenanceImpactModelFromAdminFetch,
  type ProvenanceImpactPanelModel,
} from "@/lib/fulfillment-ops/provenance-impact";

const PROVENANCE_IMPACT_PATH = "/admin/v1/fulfillment-ops/provenance-impact";

/** Server-side read. Session and observer checks happen inside adminFetchJson. */
export async function loadProvenanceImpactPanel(): Promise<ProvenanceImpactPanelModel> {
  try {
    const result = await adminFetchJson<unknown>(PROVENANCE_IMPACT_PATH);
    return provenanceImpactModelFromAdminFetch(result);
  } catch {
    return { state: "unavailable" };
  }
}
