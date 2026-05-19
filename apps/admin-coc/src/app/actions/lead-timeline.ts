"use server";

import { fetchAdminLeadTimeline } from "@/lib/admin-api/server";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";

export async function loadLeadTimelineAction(params: LeadTimelineFetchParams) {
  return fetchAdminLeadTimeline(params);
}
