"use client";

import { useId, useRef, useState, useTransition } from "react";

import { saveClientSetupAction } from "@/app/actions/clients";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ClientAccountDetail,
  ClientSetup,
  ClientSetupData,
} from "@/lib/clients/types";
import {
  clientSetupSaveAttempt,
  type ClientSetupSaveAttempt,
  type ClientSetupSaveIntent,
} from "@/lib/clients/client-setup-save-attempt";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const tabs = ["details", "source", "destination", "review"] as const;
type SetupTab = (typeof tabs)[number];

const missingLabels: Record<string, string> = {
  primaryNicheKeys: "Choose at least one niche",
  primaryProductTypes: "Choose at least one product",
  sourceProvider: "Choose a source provider",
  trafficSourceName: "Enter the traffic source",
  nextgenFunnelName: "Enter the NextGen funnel name",
  nextgenFunnelUrl: "Enter the exact NextGen funnel URL",
  providerFunnelIdOrMissingNotes: "Enter a provider funnel ID or explain why it is unavailable",
  testLeadUuid: "Enter the genuine source lead UUID",
  testSubmissionAt: "Enter the source submission time with timezone",
  webhookConfigured: "Confirm webhook configuration",
  sourceTestSubmitted: "Confirm a source-generated test submission",
  destinationChoice: "Choose a requested destination",
  ghlLocationId: "Enter the requested GHL location/subaccount",
  sheetsMode: "Choose existing or new spreadsheet",
  existingSpreadsheetUrl: "Enter the existing spreadsheet URL",
  requestedSpreadsheetName: "Enter the requested spreadsheet name",
  googleAccountOwner: "Enter the intended Google account/owner",
  reviewNotes: "Add review notes",
};

function text(data: ClientSetupData, key: keyof ClientSetupData): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

export function ClientSetupPanel({
  client,
  initialSetup,
}: {
  client: ClientAccountDetail;
  initialSetup: ClientSetup;
}) {
  const [setup, setSetup] = useState(initialSetup);
  const [data, setData] = useState<ClientSetupData>(initialSetup.data);
  const [tab, setTab] = useState<SetupTab>("details");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveAttempt = useRef<ClientSetupSaveAttempt | null>(null);

  function update<K extends keyof ClientSetupData>(key: K, value: ClientSetupData[K]) {
    setData((current) => ({ ...current, [key]: value }));
    setError(null);
    setMessage(null);
  }

  function save(intent: ClientSetupSaveIntent) {
    const attempt = clientSetupSaveAttempt(
      saveAttempt.current,
      intent,
      data,
      setup.revision
    );
    saveAttempt.current = attempt;
    startTransition(async () => {
      const result = await saveClientSetupAction(
        client.clientAccountId,
        intent,
        data,
        attempt.requestId,
        setup.revision
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      saveAttempt.current = null;
      if (result.replayed) {
        setError(null);
        setMessage(
          "The original save was already accepted. Reload before editing to check for newer changes."
        );
        return;
      }
      setSetup(result.item);
      setData(result.item.data);
      setError(null);
      setMessage(
        intent === "save_draft" || intent === "recover_draft"
          ? "Draft saved."
          : "Setup status updated."
      );
    });
  }

  const wantsGhl = data.destinationChoice === "ghl" || data.destinationChoice === "both";
  const wantsSheets =
    data.destinationChoice === "google_sheets" || data.destinationChoice === "both";

  return (
    <section className="rounded-xl border border-sky-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Client setup</h2>
            <p className="text-sm text-muted-foreground">
              Save a configuration request for review. Nothing here activates routing or delivery.
            </p>
          </div>
          <Badge variant="outline">{setup.status.replaceAll("_", " ")}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-1 sm:flex" role="tablist" aria-label="Client setup sections">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={`rounded-md px-3 py-2 text-sm capitalize ${tab === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {item === "review" ? "Checklist & review" : item}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4" role="tabpanel">
        {setup.repairRequired ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">Stored setup data needs repair</p>
            <p className="mt-1">
              The existing document cannot be safely read and has not been changed. Ordinary
              saves are blocked to prevent data loss.
            </p>
            <Button
              className="mt-3"
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    "Replace the unreadable setup document with a new empty draft? The retained audit history will not be deleted."
                  )
                ) {
                  save("recover_draft");
                }
              }}
            >
              Replace with a new empty draft
            </Button>
          </div>
        ) : null}
        {tab === "details" ? (
          <>
            <div className="grid gap-1.5">
              <Label>SA360 client account</Label>
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium">{client.clientDisplayName}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{client.clientAccountId}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Saved account IDs remain stable when the display name changes.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Client email" value={text(data, "clientEmail")} onChange={(value) => update("clientEmail", value || null)} type="email" />
              <Field label="Client phone" value={text(data, "clientPhone")} onChange={(value) => update("clientPhone", value || null)} type="tel" />
              <Field label="Geography" value={text(data, "geography")} onChange={(value) => update("geography", value || null)} placeholder="States, regions, or service area" />
              <Field label="Setup owner" value={text(data, "setupOwner")} onChange={(value) => update("setupOwner", value || null)} />
              <Field label="Planned go-live date" value={text(data, "plannedGoLiveDate")} onChange={(value) => update("plannedGoLiveDate", value || null)} type="date" />
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div><span className="font-medium">Niches:</span> {client.primaryNicheKeys.join(", ") || "Missing"}</div>
              <div><span className="font-medium">Products:</span> {client.primaryProductTypes.join(", ") || "Missing"}</div>
            </div>
          </>
        ) : null}

        {tab === "source" ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Source provider" value={data.sourceProvider ?? ""} onChange={(value) => update("sourceProvider", (value || null) as ClientSetupData["sourceProvider"])}>
                <option value="">Select provider…</option>
                <option value="nextgen">LeadCapture NextGen</option>
                <option value="other">Other provider (request only)</option>
                <option value="undecided">Undecided</option>
              </SelectField>
              <Field label="Traffic provider / source" value={text(data, "trafficSourceName")} onChange={(value) => update("trafficSourceName", value || null)} />
              <Field label="NextGen funnel name" value={text(data, "nextgenFunnelName")} onChange={(value) => update("nextgenFunnelName", value || null)} />
              <Field label="Exact funnel URL" value={text(data, "nextgenFunnelUrl")} onChange={(value) => update("nextgenFunnelUrl", value || null)} type="url" />
              <Field label="Provider funnel ID (when available)" value={text(data, "providerFunnelId")} onChange={(value) => update("providerFunnelId", value || null)} />
              <Field label="Provider campaign ID (when available)" value={text(data, "providerCampaignId")} onChange={(value) => update("providerCampaignId", value || null)} />
              <Field label="Genuine test source-lead UUID" value={text(data, "testLeadUuid")} onChange={(value) => update("testLeadUuid", value || null)} />
              <Field label="Submission time with timezone" value={text(data, "testSubmissionAt")} onChange={(value) => update("testSubmissionAt", value || null)} placeholder="2026-09-30T12:00:00-04:00" />
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Missing-information notes</span>
              <textarea className="min-h-20 rounded-md border border-input p-2" value={text(data, "sourceMissingInfoNotes")} onChange={(event) => update("sourceMissingInfoNotes", event.target.value || null)} />
            </label>
            {data.sourceProvider === "nextgen" ? (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                <p className="font-medium">Verified NextGen webhook guidance</p>
                <p className="mt-1 font-mono">POST /sources/leadcapture/nextgen/lead-created</p>
                <p>Header name: <span className="font-mono">x-sa360-leadcapture-nextgen-key</span>. Secret values are never shown here.</p>
                <p className="mt-1">Duplicate a known working webhook, avoid two active webhooks on one funnel, preserve the native payload and immutable lead UUID, and never manufacture a missing funnel ID. A synthetic request is not final source proof.</p>
              </div>
            ) : null}
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={data.webhookConfigured === true} onChange={(event) => update("webhookConfigured", event.target.checked)} /> Webhook configuration checked</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={data.sourceTestSubmitted === true} onChange={(event) => update("sourceTestSubmitted", event.target.checked)} /> Source-generated test submitted</label>
          </>
        ) : null}

        {tab === "destination" ? (
          <>
            <SelectField label="Requested destination" value={data.destinationChoice ?? ""} onChange={(value) => update("destinationChoice", (value || null) as ClientSetupData["destinationChoice"])}>
              <option value="">Select request…</option>
              <option value="ghl">GHL</option>
              <option value="google_sheets">Google Sheet</option>
              <option value="both">GHL and Google Sheet</option>
              <option value="intake_only">Intake only</option>
              <option value="undecided">Undecided</option>
            </SelectField>
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-950">
              These are requests only. They do not connect Google, create or share a spreadsheet,
              configure GHL, verify access, or enable delivery.
            </p>
            {wantsGhl ? (
              <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
                <Field label="GHL location / subaccount" value={text(data, "ghlLocationId")} onChange={(value) => update("ghlLocationId", value || null)} />
                <Field label="Workflow" value={text(data, "ghlWorkflowId")} onChange={(value) => update("ghlWorkflowId", value || null)} />
                <Field label="Assigned user" value={text(data, "ghlAssignedUserId")} onChange={(value) => update("ghlAssignedUserId", value || null)} />
              </div>
            ) : null}
            {wantsSheets ? (
              <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
                <SelectField label="Spreadsheet request" value={data.sheetsMode ?? ""} onChange={(value) => update("sheetsMode", (value || null) as ClientSetupData["sheetsMode"])}>
                  <option value="">Select mode…</option>
                  <option value="existing">Use an existing spreadsheet</option>
                  <option value="create_new">Create in a connected Google Drive (future action)</option>
                </SelectField>
                <Field label="Intended Google account / owner" value={text(data, "googleAccountOwner")} onChange={(value) => update("googleAccountOwner", value || null)} />
                {data.sheetsMode === "existing" ? <Field label="Existing spreadsheet URL" value={text(data, "existingSpreadsheetUrl")} onChange={(value) => update("existingSpreadsheetUrl", value || null)} type="url" /> : null}
                {data.sheetsMode === "create_new" ? <Field label="Requested spreadsheet name" value={text(data, "requestedSpreadsheetName")} onChange={(value) => update("requestedSpreadsheetName", value || null)} /> : null}
                <Field label="Tab (optional)" value={text(data, "worksheetName")} onChange={(value) => update("worksheetName", value || null)} />
                <Field label="Folder (optional)" value={text(data, "requestedFolder")} onChange={(value) => update("requestedFolder", value || null)} />
                <Field label="Client access recipient" value={text(data, "accessRecipient")} onChange={(value) => update("accessRecipient", value || null)} type="email" />
                <SelectField label="Requested access level" value={data.accessLevel ?? ""} onChange={(value) => update("accessLevel", (value || null) as ClientSetupData["accessLevel"])}>
                  <option value="">Select level…</option><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option>
                </SelectField>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "review" ? (
          <>
            <div>
              <h3 className="text-sm font-semibold">Next required actions</h3>
              {setup.repairRequired ? (
                <p className="mt-2 text-sm text-red-700">
                  Recover the unreadable setup document before checking submission requirements.
                  Use the explicit recovery action above.
                </p>
              ) : setup.missingRequiredFields.length ? (
                <ul className="mt-2 grid gap-1 text-sm">
                  {setup.missingRequiredFields.map((field) => <li key={field}>○ {missingLabels[field] ?? field}</li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-emerald-700">✓ Required submission information is complete.</p>}
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Review notes / requested changes</span>
              <textarea className="min-h-24 rounded-md border border-input p-2" value={text(data, "reviewNotes")} onChange={(event) => update("reviewNotes", event.target.value || null)} />
            </label>
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              Administrative review is separate from source receipt, exact client association,
              GHL delivery verification, Sheets delivery verification, and live activation.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => save("submit")} disabled={pending || setup.repairRequired}>Submit for review</Button>
              <Button type="button" variant="outline" onClick={() => save("needs_information")} disabled={pending || setup.repairRequired}>Needs information</Button>
              <Button type="button" variant="outline" onClick={() => save("setup_reviewed")} disabled={pending || setup.repairRequired}>Mark setup reviewed</Button>
            </div>
          </>
        ) : null}

        {error ? <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
        <div className="flex items-center gap-3 border-t pt-4">
          <Button type="button" variant="secondary" onClick={() => save("save_draft")} disabled={pending || setup.repairRequired}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {setup.updatedAt ? `Last saved ${new Date(setup.updatedAt).toLocaleString()}` : "Not saved yet"}
          </span>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  const id = useId();
  return <div className="grid gap-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  const id = useId();
  return <div className="grid gap-1.5"><Label htmlFor={id}>{label}</Label><select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></div>;
}
