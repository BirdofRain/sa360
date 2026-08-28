import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalJourneyHome } from "@/components/client-portal/portal-journey-home";
import { fetchClientAccountProfile } from "@/lib/client-portal-api/account";
import {
  fetchClientLeadOrdersList,
  isClientPortalApiConfigured,
} from "@/lib/client-portal-api/server";
import {
  isValidPortalAccessCode,
  portalLoginPath,
  portalPathAfterAccessGrant,
  portalSignedSessionCookieOptions,
} from "@/lib/client-portal/access-gate";
import { mapClientLeadOrderRows } from "@/lib/client-portal/map-client-orders";
import { resolvePortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { buildPortalJourneyHome } from "@/lib/client-portal/portal-journey";
import {
  loadPortalPageContext,
  safePortalNextPath,
} from "@/lib/client-portal/portal-page-context";
import { parseClientPortalRange } from "@/lib/client-portal/range";

export const dynamic = "force-dynamic";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeKey = parseClientPortalRange(firstString(sp.range));
  const nextPath = rangeKey === "7d" ? "/portal" : `/portal?range=${encodeURIComponent(rangeKey)}`;

  if (isClientPortalApiConfigured()) {
    const accessParam = firstString(sp.access);
    if (accessParam && isValidPortalAccessCode(accessParam)) {
      const signed = portalSignedSessionCookieOptions();
      if (signed) {
        const cookieStore = await cookies();
        cookieStore.set(signed);
        redirect(portalPathAfterAccessGrant(rangeKey));
      }
    }
  }

  const ctx = await loadPortalPageContext({ nextPath, rangeKey });
  if (ctx.mode === "login_required") {
    redirect(portalLoginPath(safePortalNextPath(ctx.nextPath, nextPath)));
  }
  if (ctx.mode === "access_gate") {
    return <PortalAccessGate rangeKey={ctx.rangeKey} />;
  }

  if (ctx.mode === "live") {
    const [accountResult, ordersResult] = await Promise.all([
      fetchClientAccountProfile({ clientAccountId: ctx.clientAccountId }),
      fetchClientLeadOrdersList({ clientAccountId: ctx.clientAccountId }),
    ]);

    const accountFailed = Boolean(accountResult.error) || !accountResult.account;
    const ordersFailed = Boolean(ordersResult.error);
    const previewCopy =
      accountFailed || ordersFailed
        ? resolvePortalPreviewBannerCopy("live_fetch_failed", {
            status: accountFailed ? accountResult.status : 502,
            body: accountResult.error ?? ordersResult.error ?? "partial fetch failed",
          })
        : null;

    const model = buildPortalJourneyHome({
      account: accountFailed
        ? { ok: false }
        : { ok: true, value: accountResult.account },
      orders: ordersFailed
        ? { ok: false }
        : { ok: true, value: mapClientLeadOrderRows(ordersResult.items) },
    });

    return (
      <PortalAppFrame displayName={ctx.displayName} showSignOut previewCopy={previewCopy}>
        <PortalJourneyHome model={model} displayName={ctx.displayName} />
      </PortalAppFrame>
    );
  }

  const previewCopy = resolvePortalPreviewBannerCopy("not_configured");
  const model = buildPortalJourneyHome({
    account: { ok: false },
    orders: { ok: false },
  });
  return (
    <PortalAppFrame displayName={ctx.displayName} previewCopy={previewCopy}>
      <PortalJourneyHome model={model} displayName={ctx.displayName} />
    </PortalAppFrame>
  );
}
