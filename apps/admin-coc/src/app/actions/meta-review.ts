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
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return fetchMetaReviewPages();
}

export async function loadMetaReviewPermissionsAction(): Promise<
  MetaReviewActionResult<MetaReviewPermission[]>
> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return fetchMetaReviewPermissions();
}

export async function loadMetaReviewSubscriptionAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewSubscription[]>> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return fetchMetaReviewSubscription(pageId);
}

export async function loadMetaReviewPostsAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewPost[]>> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return fetchMetaReviewPosts(pageId);
}

export async function loadMetaReviewInsightsAction(input: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaReviewActionResult<MetaReviewInsight[]>> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  return fetchMetaReviewInsights(input);
}

export async function subscribeMetaReviewLeadgenAction(input: {
  pageId: string;
  confirmed: boolean;
  confirmationText: string;
}): Promise<
  MetaReviewActionResult<{ alreadySubscribed: boolean; subscribedFields: string[] }>
> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  if (!input.confirmed) {
    return { ok: false, error: "Operator confirmation checkbox is required.", trace: null };
  }
  return postMetaReviewLeadgenSubscription(input);
}
