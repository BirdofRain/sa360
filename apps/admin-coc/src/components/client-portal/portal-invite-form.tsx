"use client";

import { useActionState } from "react";

import { portalInviteAcceptAction } from "@/app/actions/portal-invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PORTAL_INVITE_POLICY_COPY } from "@/lib/client-portal/portal-invite-flow";

export function PortalInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    { error?: string } | undefined,
    FormData
  >(portalInviteAcceptAction, undefined);

  return (
    <form action={formAction} className="mt-6 grid gap-3" autoComplete="off">
      <input type="hidden" name="token" value={token} autoComplete="off" />
      <div className="grid gap-1.5">
        <Label htmlFor="portal-invite-password" className="text-xs text-slate-600">
          New password
        </Label>
        <Input
          id="portal-invite-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          autoFocus
        />
        <p className="text-xs text-slate-500">{PORTAL_INVITE_POLICY_COPY}</p>
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
        {pending ? "Saving…" : "Save password and continue"}
      </Button>
    </form>
  );
}
