"use client";

import { useState } from "react";
import {
  approveBulkImportDeliveryAction,
  normalizeBulkImportAction,
  saveBulkImportMappingAction,
  setBulkImportDestinationAction,
  simulateBulkImportAction,
} from "@/app/actions/bulk-imports";
import { BULK_IMPORT_APPROVE_PHRASE, BULK_IMPORT_WIZARD_STEPS } from "@/lib/bulk-imports/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WizardProps = {
  importId: string;
  initial: {
    batch: Record<string, unknown>;
    summary: Record<string, number>;
  };
};

export function BulkImportWizard({ importId, initial }: WizardProps) {
  const batch = initial.batch as {
    fileName: string;
    status: string;
    mappingJson?: Record<string, string>;
    wizardStepJson?: { step?: string; previewRows?: Array<{ rowNumber: number; fields: Record<string, string> }> };
    destinationClientAccountId?: string;
    destinationLocationIdGhl?: string;
    rows?: Array<Record<string, unknown>>;
  };
  const [step, setStep] = useState(batch.wizardStepJson?.step ?? "map");
  const [message, setMessage] = useState<string | null>(null);
  const [clientId, setClientId] = useState(batch.destinationClientAccountId ?? "");
  const [locationId, setLocationId] = useState(batch.destinationLocationIdGhl ?? "");
  const [approvalText, setApprovalText] = useState("");

  async function run(action: () => Promise<unknown>, nextStep?: string) {
    setMessage(null);
    try {
      await action();
      setMessage("Saved.");
      if (nextStep) setStep(nextStep);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        {BULK_IMPORT_WIZARD_STEPS.map((s) => (
          <span
            key={s}
            className={`rounded-full border px-2 py-1 ${step === s ? "bg-primary text-primary-foreground" : ""}`}
          >
            {s}
          </span>
        ))}
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm">
          <strong>File:</strong> {batch.fileName} · <strong>Status:</strong> {batch.status}
        </p>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(initial.summary, null, 2)}
        </pre>
      </div>

      {step === "map" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Confirm auto-suggested column mapping, then continue.</p>
          <pre className="max-h-60 overflow-auto rounded border p-2 text-xs">
            {JSON.stringify(batch.mappingJson ?? {}, null, 2)}
          </pre>
          <Button
            onClick={() =>
              void run(
                () => saveBulkImportMappingAction(importId, batch.mappingJson ?? {}),
                "destination"
              )
            }
          >
            Save mapping
          </Button>
        </div>
      )}

      {step === "destination" && (
        <div className="grid max-w-lg gap-3">
          <div>
            <Label>Destination client account ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div>
            <Label>GHL location ID</Label>
            <Input value={locationId} onChange={(e) => setLocationId(e.target.value)} />
          </div>
          <Button
            onClick={() =>
              void run(
                () =>
                  setBulkImportDestinationAction(importId, {
                    destinationClientAccountId: clientId,
                    destinationLocationIdGhl: locationId,
                    workflowStrategy: "source_tag_only",
                    workflowWarningAcknowledged: true,
                  }),
                "review"
              )
            }
          >
            Select destination
          </Button>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-3">
          <p className="text-sm">Normalize rows into Source Intake events (no GHL writes).</p>
          <Button onClick={() => void run(() => normalizeBulkImportAction(importId), "simulate")}>
            Normalize &amp; review
          </Button>
        </div>
      )}

      {step === "simulate" && (
        <div className="space-y-3">
          <p className="text-sm">Run adapter simulation on first eligible rows (no external writes).</p>
          <Button onClick={() => void run(() => simulateBulkImportAction(importId, 5), "approve")}>
            Simulate first 5 rows
          </Button>
        </div>
      )}

      {step === "approve" && (
        <div className="grid max-w-lg gap-3">
          <p className="text-sm text-amber-700">
            Type {BULK_IMPORT_APPROVE_PHRASE} to approve a capped delivery wave (max 250 rows).
          </p>
          <Input value={approvalText} onChange={(e) => setApprovalText(e.target.value)} />
          <Button
            variant="destructive"
            disabled={approvalText.trim() !== BULK_IMPORT_APPROVE_PHRASE}
            onClick={() =>
              void run(
                () => approveBulkImportDeliveryAction(importId, approvalText, 100),
                "monitor"
              )
            }
          >
            Approve delivery wave
          </Button>
        </div>
      )}

      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
