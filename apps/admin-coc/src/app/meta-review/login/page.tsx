import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MetaReviewerLoginForm } from "@/components/meta-review/meta-reviewer-login-form";
import { ADMIN_COC_ROLE_ADMIN } from "@/lib/admin-coc-observer-access";
import { readAdminCocSessionRole } from "@/lib/admin-coc-session-guard";
import { isMetaReviewEnabled } from "@/lib/meta-review/config";
import { readValidMetaReviewerSession } from "@/lib/meta-reviewer-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meta App Review Access",
  robots: { index: false, follow: false },
};

export default async function MetaReviewerLoginPage() {
  if (!isMetaReviewEnabled()) notFound();

  const reviewer = await readValidMetaReviewerSession();
  const adminRole = await readAdminCocSessionRole();
  if (reviewer || adminRole === ADMIN_COC_ROLE_ADMIN) {
    redirect("/meta-review");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
            S
          </div>
          <div className="text-sm font-semibold leading-tight text-slate-900">SA360</div>
        </div>
        <h1 className="text-base font-semibold text-slate-900">Meta App Review Access</h1>
        <p className="mt-1 text-xs text-slate-500">
          Restricted read-only access for Meta App Review. No Facebook login is required.
        </p>
        <MetaReviewerLoginForm />
      </div>
    </main>
  );
}
