"use server";

import { requireAdminCocReadSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminLeadTimeline, fetchAdminSourceIntakeTrace } from "@/lib/admin-api/server";
import type { SourceIntakeTraceFetchParams } from "@/lib/admin-api/server";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";

export async function loadLeadTimelineAction(params: LeadTimelineFetchParams) {
  await requireAdminCocReadSession();
  return fetchAdminLeadTimeline(params);
}

export async function loadSourceIntakeTraceAction(params: SourceIntakeTraceFetchParams) {
  await requireAdminCocReadSession();
  return fetchAdminSourceIntakeTrace(params);
}
