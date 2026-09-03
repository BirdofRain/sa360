"use client";

import { useActionState } from "react";

import { portalPasswordResetRequestAction } from "@/app/actions/portal-password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PORTAL_FORGOT_PASSWORD_EMAIL_LABEL,
  PORTAL_FORGOT_PASSWORD_SUBMIT,
  PORTAL_PASSWORD_RESET_GENERIC,
} from "@/lib/client-portal/portal-password-reset-flow";

export function PortalForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<
    { submitted?: boolean; message?: string } | undefined,
    FormData
  >(portalPasswordResetRequestAction, undefined);

  if (state?.submitted) {
    return (
      <p
        role="status"
        className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-700"
      >
        {state.message ?? PORTAL_PASSWORD_RESET_GENERIC}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="portal-forgot-password-email" className="text-xs text-slate-600">
          {PORTAL_FORGOT_PASSWORD_EMAIL_LABEL}
        </Label>
        <Input
          id="portal-forgot-password-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : PORTAL_FORGOT_PASSWORD_SUBMIT}
      </Button>
    </form>
  );
}
