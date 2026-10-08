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

async function requireMetaReviewAdmin(): Promise<void> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
}

export async function loadMetaReviewPagesAction(): Promise<
  MetaReviewActionResult<MetaReviewPage[]>
> {
  await requireMetaReviewAdmin();
  return fetchMetaReviewPages();
}

export async function loadMetaReviewPermissionsAction(): Promise<
  MetaReviewActionResult<MetaReviewPermission[]>
> {
  await requireMetaReviewAdmin();
  return fetchMetaReviewPermissions();
}

export async function loadMetaReviewSubscriptionAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewSubscription[]>> {
  await requireMetaReviewAdmin();
  return fetchMetaReviewSubscription(pageId);
}

export async function loadMetaReviewPostsAction(
  pageId: string
): Promise<MetaReviewActionResult<MetaReviewPost[]>> {
  await requireMetaReviewAdmin();
  return fetchMetaReviewPosts(pageId);
}

export async function loadMetaReviewInsightsAction(input: {
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaReviewActionResult<MetaReviewInsight[]>> {
  await requireMetaReviewAdmin();
  return fetchMetaReviewInsights(input);
}

export async function subscribeMetaReviewLeadgenAction(input: {
  pageId: string;
  confirmed: boolean;
  confirmationText: string;
}): Promise<
  MetaReviewActionResult<{ alreadySubscribed: boolean; subscribedFields: string[] }>
> {
  await requireMetaReviewAdmin();
  if (!input.confirmed) {
    return { ok: false, error: "Operator confirmation checkbox is required.", trace: null };
  }
  return postMetaReviewLeadgenSubscription(input);
}
