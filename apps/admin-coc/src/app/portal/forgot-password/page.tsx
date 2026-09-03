import Link from "next/link";

import { PortalForgotPasswordForm } from "@/components/client-portal/portal-forgot-password-form";
import { getClientPortalDisplayName } from "@/lib/client-portal/config";
import {
  PORTAL_FORGOT_PASSWORD_BACK_TO_LOGIN,
  PORTAL_FORGOT_PASSWORD_INTRO,
  PORTAL_FORGOT_PASSWORD_TITLE,
} from "@/lib/client-portal/portal-password-reset-flow";

export const dynamic = "force-dynamic";

export default function PortalForgotPasswordPage() {
  const displayName = getClientPortalDisplayName();

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {displayName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {PORTAL_FORGOT_PASSWORD_TITLE}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{PORTAL_FORGOT_PASSWORD_INTRO}</p>
          <PortalForgotPasswordForm />
          <p className="mt-4 text-xs">
            <Link href="/portal/login" className="text-slate-600 underline-offset-4 hover:underline">
              {PORTAL_FORGOT_PASSWORD_BACK_TO_LOGIN}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
