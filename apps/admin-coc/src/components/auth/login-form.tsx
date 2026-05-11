"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/actions/login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<
    { error?: string } | undefined,
    FormData
  >(loginAction, undefined);

  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-1.5">
        <Label htmlFor="login-password" className="text-xs text-slate-600">
          Password
        </Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
        />
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
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
