import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalAccessGate } from "@/components/client-portal/portal-access-gate";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalSmsOptInForm } from "@/components/client-portal/portal-sms-opt-in";
import { PORTAL_SMS_OPT_IN_PREVIEW } from "@/components/client-portal/portal-sms-disclosure";
import { portalLoginPath } from "@/lib/client-portal/access-gate";
import { loadPortalPageContext } from "@/lib/client-portal/portal-page-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Text notifications",
  description: "Optional operational text notifications from Life Agent Launch.",
};

export default async function PortalSmsNotificationsPage() {
  const ctx = await loadPortalPageContext({ nextPath: "/portal/sms-notifications" });
  if (ctx.mode === "login_required") redirect(portalLoginPath(ctx.nextPath));
  if (ctx.mode === "access_gate") return <PortalAccessGate rangeKey={ctx.rangeKey} />;

  return (
    <PortalAppFrame displayName={ctx.mode === "live" ? ctx.displayName : ctx.displayName} showSignOut={ctx.mode === "live"}>
      <PortalSmsOptInForm preview={PORTAL_SMS_OPT_IN_PREVIEW} />
    </PortalAppFrame>
  );
}
