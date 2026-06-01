"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createClientAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ClientCreateForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [clientAccountId, setClientAccountId] = useState("");
  const [clientDisplayName, setClientDisplayName] = useState("");
  const [nicheKeys, setNicheKeys] = useState("");
  const [productTypes, setProductTypes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createClientAction({
        clientAccountId: clientAccountId.trim(),
        clientDisplayName: clientDisplayName.trim(),
        status: "onboarding",
        primaryNicheKeys: nicheKeys
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        primaryProductTypes: productTypes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
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
    <form onSubmit={submit} className="grid max-w-lg gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="clientAccountId">Client account ID</Label>
        <Input
          id="clientAccountId"
          value={clientAccountId}
          onChange={(e) => setClientAccountId(e.target.value)}
          placeholder="breanna_kimberling"
          pattern="[a-z][a-z0-9_]*"
          required
          disabled={pending}
        />
        <p className="text-[11px] text-muted-foreground">Lowercase slug: a-z, 0-9, underscore.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="clientDisplayName">Display name</Label>
        <Input
          id="clientDisplayName"
          value={clientDisplayName}
          onChange={(e) => setClientDisplayName(e.target.value)}
          required
          disabled={pending}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nicheKeys">Primary niches (comma-separated)</Label>
        <Input
          id="nicheKeys"
          value={nicheKeys}
          onChange={(e) => setNicheKeys(e.target.value)}
          placeholder="VET"
          disabled={pending}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="productTypes">Primary products (comma-separated)</Label>
        <Input
          id="productTypes"
          value={productTypes}
          onChange={(e) => setProductTypes(e.target.value)}
          placeholder="Final Expense"
          disabled={pending}
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
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
