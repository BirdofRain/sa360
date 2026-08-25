import type { ReactNode } from "react";

import { portalLogoutAction } from "@/app/actions/portal-login";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { PortalPreviewBannerCopy } from "@/lib/client-portal/portal-display";
import { getClientPortalDisplayName } from "@/lib/client-portal/config";

import { PortalNav } from "./portal-nav";

export function PortalAppFrame({
  children,
  displayName,
  showSignOut = false,
  previewCopy,
}: {
  children: ReactNode;
  displayName?: string;
  showSignOut?: boolean;
  previewCopy?: PortalPreviewBannerCopy | null;
}) {
  const brand = getClientPortalDisplayName();
  const accountLabel = displayName?.trim() || brand;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Customer portal
              </p>
              <p className="truncate text-sm font-semibold text-slate-900">{accountLabel}</p>
            </div>
            {showSignOut ? (
              <form action={portalLogoutAction}>
                <button
                  type="submit"
                  className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                >
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
          <PortalNav />
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {previewCopy?.warningTitle && previewCopy.warningDetail ? (
          <WarningBanner tone="err" title={previewCopy.warningTitle}>
            {previewCopy.warningDetail}
          </WarningBanner>
        ) : null}
        {previewCopy?.previewBanner ? (
          <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-center text-xs text-sky-800">
            {previewCopy.previewBanner}
          </p>
        ) : null}
        {children}
        <footer className="pt-2 text-center text-xs text-slate-400">
          Powered by SA360 · Questions? Contact your account team.
        </footer>
      </div>
    </div>
  );
}
