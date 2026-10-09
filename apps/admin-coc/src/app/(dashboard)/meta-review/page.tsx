import { notFound } from "next/navigation";

import {
  loadMetaReviewInsightsAction,
  loadMetaReviewPagesAction,
  loadMetaReviewPermissionsAction,
  loadMetaReviewPostsAction,
  loadMetaReviewSubscriptionAction,
  subscribeMetaReviewLeadgenAction,
} from "@/app/actions/meta-review";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { MetaReviewPanel } from "@/components/meta-review/meta-review-panel";
import { fetchMetaReviewPreflight } from "@/lib/admin-api/meta-review-server";
import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { isMetaReviewEnabled } from "@/lib/meta-review/config";

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function MetaReviewPage() {
  await requireAdminCocAdminSession();
  if (!isMetaReviewEnabled()) notFound();

  const preflight = await fetchMetaReviewPreflight();
  if (!preflight.ok) {
    return (
      <WarningBanner tone="err" title="Meta review preflight unavailable">
        {preflight.error}
      </WarningBanner>
    );
  }

  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 6);

  return (
    <MetaReviewPanel
      preflight={preflight.data}
      defaultSince={dateOnly(since)}
      defaultUntil={dateOnly(until)}
      loadPages={loadMetaReviewPagesAction}
      loadPermissions={loadMetaReviewPermissionsAction}
      loadSubscription={loadMetaReviewSubscriptionAction}
      loadPosts={loadMetaReviewPostsAction}
      loadInsights={loadMetaReviewInsightsAction}
      subscribeLeadgen={subscribeMetaReviewLeadgenAction}
    />
  );
}
