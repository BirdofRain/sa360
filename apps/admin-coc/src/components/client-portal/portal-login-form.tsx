"use client";

import { useActionState } from "react";

import Link from "next/link";

import { portalLoginAction } from "@/app/actions/portal-login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PORTAL_FORGOT_PASSWORD_LINK,
  PORTAL_FORGOT_PASSWORD_PATH,
} from "@/lib/client-portal/portal-login-flow";

export function PortalLoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<
    { error?: string } | undefined,
    FormData
  >(portalLoginAction, undefined);

  return (
    <form action={formAction} className="mt-6 grid gap-3">
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-1.5">
        <Label htmlFor="portal-login-email" className="text-xs text-slate-600">
          Email
        </Label>
        <Input
          id="portal-login-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="portal-login-password" className="text-xs text-slate-600">
          Password
        </Label>
        <Input
          id="portal-login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <p className="text-xs">
          <Link
            href={PORTAL_FORGOT_PASSWORD_PATH}
            className="text-slate-600 underline-offset-4 hover:underline"
          >
            {PORTAL_FORGOT_PASSWORD_LINK}
          </Link>
        </p>
      </div>
      {state?.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
        >
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Continue to dashboard"}
      </Button>
    </form>
  );
}
