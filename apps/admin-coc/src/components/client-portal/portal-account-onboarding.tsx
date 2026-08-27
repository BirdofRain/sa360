"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionPanel } from "@/components/dashboard/section-panel";
import {
  clientProfileFieldError,
  formatCommaSeparatedList,
  isPortalAccountSetupComplete,
  type PortalAccountActionState,
  type PortalAccountFormAction,
  type PortalAccountProfile,
} from "@/lib/client-portal/account-profile";
function latestAccount(
  initial: PortalAccountProfile,
  saveState: PortalAccountActionState | undefined,
  completeState: PortalAccountActionState | undefined
): PortalAccountProfile {
  if (completeState?.ok && completeState.account) return completeState.account;
  if (saveState?.ok && saveState.account) return saveState.account;
  return completeState?.account ?? saveState?.account ?? initial;
}

export function PortalAccountOnboarding({
  initialAccount,
  readOnly = false,
  saveActionImpl,
  completeActionImpl,
  onSuccess,
}: {
  initialAccount: PortalAccountProfile;
  readOnly?: boolean;
  saveActionImpl: PortalAccountFormAction;
  completeActionImpl: PortalAccountFormAction;
  onSuccess?: () => void;
}) {
  const refreshedRef = useRef(false);
  const [saveState, saveAction, savePending] = useActionState(saveActionImpl, undefined);
  const [completeState, completeAction, completePending] = useActionState(
    completeActionImpl,
    undefined
  );
  useEffect(() => {
    if (refreshedRef.current) return;
    if (saveState?.ok || completeState?.ok) {
      refreshedRef.current = true;
      onSuccess?.();
    }
  }, [saveState, completeState, onSuccess]);
  const account = latestAccount(initialAccount, saveState, completeState);
  const complete = isPortalAccountSetupComplete(account);
  const pending = savePending || completePending;
  const missingFields = completeState?.missingFields ?? [];
  const formError = completeState?.ok === false ? completeState.error : saveState?.ok === false ? saveState.error : undefined;
  const saveSuccess = saveState?.ok && !complete;

  const [displayName, setDisplayName] = useState(account.clientDisplayName);
  const [greeting, setGreeting] = useState(account.portalDisplayName ?? "");
  const [niches, setNiches] = useState(formatCommaSeparatedList(account.primaryNicheKeys));
  const [products, setProducts] = useState(formatCommaSeparatedList(account.primaryProductTypes));

  const nameError = clientProfileFieldError("clientDisplayName", missingFields);
  const nicheError = clientProfileFieldError("primaryNicheKeys", missingFields);
  const productError = clientProfileFieldError("primaryProductTypes", missingFields);

  if (complete) {
    return (
      <section
        aria-labelledby="account-setup-complete-title"
        className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 sm:px-5"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden />
          <div>
            <h2
              id="account-setup-complete-title"
              className="text-lg font-semibold tracking-tight text-emerald-950"
            >
              Account setup complete
            </h2>
            <p className="mt-1 text-sm text-emerald-900">You’re ready to place an order.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <SectionPanel>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <h2 className="text-lg font-semibold tracking-tight text-amber-950">
            Complete your account
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Add the required details so we can treat this account as ready to order.
          </p>
        </div>

        <form className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="clientDisplayName" className="text-slate-800">
              Account name <span className="font-normal text-slate-500">(required)</span>
            </Label>
            <Input
              id="clientDisplayName"
              name="clientDisplayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              aria-required="true"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "clientDisplayName-error" : "clientDisplayName-help"}
              disabled={pending || readOnly}
              className="min-h-10"
              autoComplete="organization"
            />
            <p id="clientDisplayName-help" className="text-xs text-slate-500">
              The business name on your account.
            </p>
            {nameError ? (
              <p id="clientDisplayName-error" role="alert" className="text-xs text-red-700">
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="portalDisplayName" className="text-slate-800">
              Greeting name <span className="font-normal text-slate-500">(optional)</span>
            </Label>
            <Input
              id="portalDisplayName"
              name="portalDisplayName"
              value={greeting}
              onChange={(event) => setGreeting(event.target.value)}
              disabled={pending || readOnly}
              className="min-h-10"
              autoComplete="nickname"
              aria-describedby="portalDisplayName-help"
            />
            <p id="portalDisplayName-help" className="text-xs text-slate-500">
              How we greet you in the portal, if different from your account name.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="primaryNicheKeys" className="text-slate-800">
              Lead focus <span className="font-normal text-slate-500">(required)</span>
            </Label>
            <Input
              id="primaryNicheKeys"
              name="primaryNicheKeys"
              value={niches}
              onChange={(event) => setNiches(event.target.value)}
              required
              aria-required="true"
              aria-invalid={nicheError ? true : undefined}
              aria-describedby={nicheError ? "primaryNicheKeys-error" : "primaryNicheKeys-help"}
              disabled={pending || readOnly}
              className="min-h-10"
              placeholder="Veteran, Trucker"
            />
            <p id="primaryNicheKeys-help" className="text-xs text-slate-500">
              Add at least one, separated by commas.
            </p>
            {nicheError ? (
              <p id="primaryNicheKeys-error" role="alert" className="text-xs text-red-700">
                {nicheError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="primaryProductTypes" className="text-slate-800">
              Product types <span className="font-normal text-slate-500">(required)</span>
            </Label>
            <Input
              id="primaryProductTypes"
              name="primaryProductTypes"
              value={products}
              onChange={(event) => setProducts(event.target.value)}
              required
              aria-required="true"
              aria-invalid={productError ? true : undefined}
              aria-describedby={
                productError ? "primaryProductTypes-error" : "primaryProductTypes-help"
              }
              disabled={pending || readOnly}
              className="min-h-10"
              placeholder="Final Expense, Aged"
            />
            <p id="primaryProductTypes-help" className="text-xs text-slate-500">
              Add at least one, separated by commas.
            </p>
            {productError ? (
              <p id="primaryProductTypes-error" role="alert" className="text-xs text-red-700">
                {productError}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {formError}
            </p>
          ) : null}
          {saveSuccess ? (
            <p
              role="status"
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              Progress saved. Finish setup when the required fields are complete.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              formAction={completeAction}
              disabled={pending || readOnly}
              size="lg"
              className="min-h-10 w-full sm:w-auto"
            >
              {completePending ? "Finishing setup…" : "Finish account setup"}
            </Button>
            <Button
              type="submit"
              formAction={saveAction}
              variant="outline"
              disabled={pending || readOnly}
              size="lg"
              className="min-h-10 w-full sm:w-auto"
            >
              {savePending ? "Saving…" : "Save progress"}
            </Button>
          </div>
        </form>
      </div>
    </SectionPanel>
  );
}
