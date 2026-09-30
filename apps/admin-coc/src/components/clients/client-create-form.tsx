"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createClientAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientProfileMultiSelect } from "@/components/clients/client-profile-multi-select";
import {
  CLIENT_ACCOUNT_ID_MAX_LENGTH,
  CLIENT_ACCOUNT_ID_PATTERN,
  accountIdAfterDisplayNameChange,
  manuallyEditedAccountId,
  resetToSuggestedAccountId,
  suggestClientAccountId,
} from "@/lib/clients/client-account-id-suggestion";
import {
  CLIENT_NICHE_OPTIONS,
  CLIENT_PRODUCT_OPTIONS,
} from "@/lib/clients/client-profile-options";

export function ClientCreateForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [clientAccountId, setClientAccountId] = useState("");
  const [clientDisplayName, setClientDisplayName] = useState("");
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [nicheKeys, setNicheKeys] = useState<string[]>([]);
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const suggestion = suggestClientAccountId(clientDisplayName);

  function updateDisplayName(value: string) {
    setClientDisplayName(value);
    const next = accountIdAfterDisplayNameChange(
      { value: clientAccountId, manuallyEdited: idManuallyEdited },
      value
    );
    setClientAccountId(next.value);
  }

  function useSuggestedId() {
    const next = resetToSuggestedAccountId(clientDisplayName);
    setIdManuallyEdited(next.manuallyEdited);
    setClientAccountId(next.value);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createClientAction({
        clientAccountId: clientAccountId.trim(),
        clientDisplayName: clientDisplayName.trim(),
        status: "onboarding",
        primaryNicheKeys: nicheKeys,
        primaryProductTypes: productTypes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/clients/${encodeURIComponent(result.item.clientAccountId)}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="clientDisplayName">Client full name / display name</Label>
        <Input
          id="clientDisplayName"
          value={clientDisplayName}
          onChange={(e) => updateDisplayName(e.target.value)}
          placeholder="Sam Hebda or Acme Advisors"
          required
          disabled={pending}
        />
        <p className="text-[11px] text-muted-foreground">
          A person, business, or team name is supported.
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="clientAccountId">Client account ID</Label>
          {idManuallyEdited ? (
            <button type="button" onClick={useSuggestedId} className="text-xs text-sky-700 hover:underline">
              Use suggested ID
            </button>
          ) : null}
        </div>
        <Input
          id="clientAccountId"
          value={clientAccountId}
          onChange={(e) => {
            const next = manuallyEditedAccountId(e.target.value);
            setIdManuallyEdited(next.manuallyEdited);
            setClientAccountId(next.value);
          }}
          placeholder="sam_hebda"
          pattern={CLIENT_ACCOUNT_ID_PATTERN.source}
          maxLength={CLIENT_ACCOUNT_ID_MAX_LENGTH}
          required
          disabled={pending}
          className="font-mono"
          aria-describedby="clientAccountId-help"
        />
        <p id="clientAccountId-help" className="text-[11px] text-muted-foreground">
          {idManuallyEdited
            ? "Custom ID preserved when the display name changes."
            : suggestion.message ?? "Suggested from the display name. Lowercase letters, numbers, and underscores only."}
        </p>
      </div>
      <ClientProfileMultiSelect label="Primary niches" options={CLIENT_NICHE_OPTIONS} value={nicheKeys} onChange={setNicheKeys} disabled={pending} />
      <ClientProfileMultiSelect label="Primary products" options={CLIENT_PRODUCT_OPTIONS} value={productTypes} onChange={setProductTypes} disabled={pending} />
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create client"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
