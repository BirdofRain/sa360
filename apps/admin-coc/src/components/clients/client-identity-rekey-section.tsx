"use client";

import { buildClientRekeyConfirmationPhrase } from "@sa360/shared";
import { useState, useTransition } from "react";
import {
  executeClientRekeyAction,
  previewClientRekeyAction,
} from "@/app/actions/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preview = {
  sourceClientAccountId: string;
  targetClientAccountId: string;
  sourceExists: boolean;
  targetExists: boolean;
  locationIds: string[];
  references: Record<string, number>;
  conflicts: string[];
  safeToExecute: boolean;
};

type Props = {
  clientAccountId: string;
  onRekeyComplete?: () => void;
};

export function ClientIdentityRekeySection({ clientAccountId, onRekeyComplete }: Props) {
  const [targetClientAccountId, setTargetClientAccountId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expectedPhrase = targetClientAccountId.trim()
    ? buildClientRekeyConfirmationPhrase(clientAccountId, targetClientAccountId.trim())
    : "";

  function runPreview() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewClientRekeyAction(clientAccountId, targetClientAccountId.trim());
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview(result.preview as Preview);
    });
  }

  function runRekey() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await executeClientRekeyAction(
        clientAccountId,
        targetClientAccountId.trim(),
        confirmation
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Client identity rekeyed to ${result.targetClientAccountId}. ${Object.values(result.movedReferences).reduce((sum, n) => sum + n, 0)} reference(s) migrated.`
      );
      setPreview(null);
      setConfirmation("");
      onRekeyComplete?.();
    });
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Client identity</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Current ID: <span className="font-mono">{clientAccountId}</span>
        </p>
        <p className="text-sm text-amber-900 mt-2">
          Client account ID is a durable internal identity. Changing it requires migrating all
          SA360 references. This does not rename the GHL subaccount.
        </p>
      </div>

      <div className="grid gap-2 max-w-xl">
        <Label htmlFor="rekey-target">Target client account ID</Label>
        <Input
          id="rekey-target"
          value={targetClientAccountId}
          onChange={(e) => setTargetClientAccountId(e.target.value)}
          placeholder="smart_agent_360_demo"
          className="font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending || !targetClientAccountId.trim()}
          onClick={runPreview}
        >
          {pending ? "Loading…" : "Preview rekey"}
        </Button>
      </div>

      {preview ? (
        <div className="rounded-md border bg-background p-3 text-sm space-y-2">
          <p>
            <strong>Safe to execute:</strong> {preview.safeToExecute ? "Yes" : "No"}
          </p>
          <p>
            <strong>Target exists:</strong> {preview.targetExists ? "Yes" : "No"}
          </p>
          {preview.locationIds.length ? (
            <p>
              <strong>Location IDs:</strong> {preview.locationIds.join(", ")}
            </p>
          ) : null}
          {preview.conflicts.length ? (
            <ul className="list-disc pl-5 text-destructive">
              {preview.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="cursor-pointer">Reference counts</summary>
            <pre className="mt-2 overflow-auto text-xs">
              {JSON.stringify(preview.references, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}

      {preview?.safeToExecute ? (
        <div className="grid gap-2 max-w-xl">
          <Label htmlFor="rekey-confirmation">
            Type: <span className="font-mono text-xs">{expectedPhrase}</span>
          </Label>
          <Input
            id="rekey-confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="font-mono"
          />
          <Button
            type="button"
            variant="destructive"
            disabled={pending || confirmation.trim() !== expectedPhrase}
            onClick={runRekey}
          >
            {pending ? "Rekeying…" : "Rekey/merge client identity"}
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-green-700">{success}</p> : null}
    </div>
  );
}
