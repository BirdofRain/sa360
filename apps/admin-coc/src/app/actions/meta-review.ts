"use server";

import {
  fetchMetaReviewInsights,
  fetchMetaReviewPages,
  fetchMetaReviewPermissions,
  fetchMetaReviewPosts,
  fetchMetaReviewSubscription,
  postMetaReviewLeadgenSubscription,
} from "@/lib/admin-api/meta-review-server";
import {
  requireAdminCocAdminSession,
  requireAdminCocSession,
} from "@/lib/admin-coc-session-guard";
import {
  denyMetaReviewerMutation,
  requireMetaReviewReadSession,
} from "@/lib/meta-reviewer-guard";
import type {
  MetaReviewActionResult,
  MetaReviewInsight,
  MetaReviewPage,
  MetaReviewPermission,
  MetaReviewPost,
  MetaReviewSubscription,
} from "@/lib/meta-review/types";

export async function loadMetaReviewPagesAction(): Promise<
  MetaReviewActionResult<MetaReviewPage[]>
> {
  await requireMetaReviewReadSession();
  return fetchMetaReviewPages();
}

export async function loadMetaReviewPermissionsAction(): Promise<
  MetaReviewActionResult<MetaReviewPermission[]>
> {
  await requireMetaReviewReadSession();
  return fetchMetaReviewPermissions();
}

export async function loadMetaReviewSubscriptionAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewSubscription[]>> {
  await requireMetaReviewReadSession();
  return fetchMetaReviewSubscription(pageId);
}

export async function loadMetaReviewPostsAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewPost[]>> {
  await requireMetaReviewReadSession();
  return fetchMetaReviewPosts(pageId);
}

export async function loadMetaReviewInsightsAction(input: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaReviewActionResult<MetaReviewInsight[]>> {
  await requireMetaReviewReadSession();
  return fetchMetaReviewInsights(input);
}

export async function subscribeMetaReviewLeadgenAction(input: {
  pageId: string;
  confirmed: boolean;
  confirmationText: string;
}): Promise<
  MetaReviewActionResult<{ alreadySubscribed: boolean; subscribedFields: string[] }>
> {
  await denyMetaReviewerMutation();
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  if (!input.confirmed) {
    return { ok: false, error: "Operator confirmation checkbox is required.", trace: null };
  }
  return postMetaReviewLeadgenSubscription(input);
}
