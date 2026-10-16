import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import { MetaReviewerShell } from "@/components/meta-review/meta-reviewer-shell";
import { fetchMetaReviewPreflight } from "@/lib/admin-api/meta-review-server";
import { isMetaReviewEnabled } from "@/lib/meta-review/config";
import {
  resolveMetaReviewAudience,
  type MetaReviewAudience,
} from "@/lib/meta-reviewer-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meta App Review",
  description: "Read-only Meta App Review evidence. No customer data is shown.",
  robots: { index: false, follow: false },
};

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function frame(audience: MetaReviewAudience, body: ReactNode) {
  if (audience === "reviewer") return <MetaReviewerShell>{body}</MetaReviewerShell>;
  const { MetaReviewAdminFrame } = await import("@/components/meta-review/meta-review-admin-frame");
  return <MetaReviewAdminFrame>{body}</MetaReviewAdminFrame>;
}

export default async function MetaReviewPage() {
  const audience = await resolveMetaReviewAudience();
  if (!isMetaReviewEnabled()) notFound();

  const preflight = await fetchMetaReviewPreflight();
  if (!preflight.ok) {
    return frame(
      audience,
      <WarningBanner tone="err" title="Meta review preflight unavailable">
        {preflight.error}
      </WarningBanner>
    );
  }

  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 6);

  return frame(
    audience,
    <MetaReviewPanel
      preflight={preflight.data}
      defaultSince={dateOnly(since)}
      defaultUntil={dateOnly(until)}
      loadPages={loadMetaReviewPagesAction}
      loadPermissions={loadMetaReviewPermissionsAction}
      loadSubscription={loadMetaReviewSubscriptionAction}
      loadPosts={loadMetaReviewPostsAction}
      loadInsights={loadMetaReviewInsightsAction}
      subscribeLeadgen={audience === "admin" ? subscribeMetaReviewLeadgenAction : undefined}
      accessMode={audience}
    />
  );
}
