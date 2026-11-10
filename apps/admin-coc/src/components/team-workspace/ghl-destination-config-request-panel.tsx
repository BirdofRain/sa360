"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadTeamWorkspaceGhlConfigurationAction,
  previewTeamWorkspaceGhlLocationAction,
  saveTeamWorkspaceGhlConfigurationRequestAction,
  type GhlConfigLoadResult,
  type GhlConfigSaveResult,
} from "@/app/actions/team-workspace-ghl-destination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { GuidedGhlLocationChoice } from "@/lib/team-workspace/ghl-destination";
import {
  buildGhlConfigSubmitBody,
  draftFromStoredRequest,
  emptyGhlConfigDraft,
  formatGhlConfigTimestamp,
  presentGhlConfigRequestProgress,
  reviewGhlConfigDraft,
  type GhlConfigDraft,
  type GhlConfigHead,
  type GhlConfigSubmitBody,
  type GhlLocationPreview,
} from "@/lib/team-workspace/ghl-destination-config-request";

const STEP_CLASS = {
  complete: "border-sky-200 bg-sky-50 text-sky-950",
  current: "border-amber-200 bg-amber-50 text-amber-950",
  waiting: "border-slate-200 bg-white text-slate-600",
} as const;

export type OperationalDestinationStatus = {
  configured: boolean;
  verified: boolean;
  active: boolean;
  live: boolean;
  locationId: string | null;
  updatedAt: string | null;
};

type Hold = { kind: "submit"; body: GhlConfigSubmitBody } | { kind: "reload" };

export function GhlDestinationConfigRequestPanel({
  clientAccountId,
  locations,
  locationsState,
  operational,
}: {
  clientAccountId: string;
  locations: GuidedGhlLocationChoice[];
  locationsState: "loading" | "ready" | "unavailable";
  operational: OperationalDestinationStatus | null;
}) {
  const [head, setHead] = useState<GhlConfigHead | null>(null);
  const [draft, setDraft] = useState<GhlConfigDraft>(emptyGhlConfigDraft);
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, GhlLocationPreview>>({});
  const [pending, setPending] = useState<string | null>("Loading the configuration request…");
  const [message, setMessage] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    setDraft(emptyGhlConfigDraft());
    setHead(null);
    setPreviews({});
    setHold(null);
    setDisabled(false);
    setReplaceConfirmed(false);
    setPreviewNote(null);
    setMessage(null);
    setPending("Loading the configuration request…");
    void loadTeamWorkspaceGhlConfigurationAction(clientAccountId)
      .then((result) => {
        if (cancelled) return;
        applyLoaded(result, false);
      })
      .catch(() => {
        if (cancelled) return;
        setMessage("You do not have permission to read this configuration request. Portal and observer access are not accepted.");
        setDisabled(true);
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientAccountId]);

  function applyLoaded(result: GhlConfigLoadResult, replaceDraft: boolean) {
    if (!result.ok || !result.head) {
      setHead(null);
      setDisabled(result.code === "FEATURE_DISABLED");
      setMessage(result.message);
      return;
    }
    setDisabled(false);
    setHead(result.head);
    if (replaceDraft || !dirtyRef.current) {
      dirtyRef.current = false;
      setDraft(draftFromStoredRequest(result.head.configuration));
      setReplaceConfirmed(false);
    }
  }

  const preview = draft.locationId ? previews[draft.locationId] ?? null : null;
  const review = useMemo(
    () =>
      reviewGhlConfigDraft({
        draft,
        preview,
        locations,
        liveDestination: Boolean(head?.liveDestination || operational?.live),
        operationalUpdatedAt: operational ? operational.updatedAt : undefined,
        head,
      }),
    [draft, preview, locations, head, operational]
  );
  const steps = presentGhlConfigRequestProgress(head);
  const stored = head?.configuration ?? null;
  const connected = locations.filter((location) => location.connectionStatus === "connected");
  const disconnected = locations.filter((location) => location.connectionStatus !== "connected");
  const visibleLocations = connected.filter((location) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${location.locationName ?? ""} ${location.locationId}`.toLowerCase().includes(needle);
  });
  const locked = Boolean(pending || hold);
  const canSave = Boolean(head) && !disabled && !locked && review.canSubmit && (!stored || replaceConfirmed);

  function edit(next: GhlConfigDraft) {
    if (hold) return;
    dirtyRef.current = true;
    setReplaceConfirmed(false);
    setDraft(next);
  }

  function chooseLocation(locationId: string) {
    if (hold || locationId === draft.locationId) return;
    edit({ locationId, workflowId: "", mappings: {} });
    setPreviewNote(null);
  }

  async function readSnapshot(refresh: boolean) {
    const locationId = draft.locationId.trim();
    if (!locationId || inflight.current || hold) return;
    inflight.current = true;
    setPending(refresh ? "Refreshing this location's snapshot…" : "Loading this location's snapshot…");
    setPreviewNote(null);
    try {
      const result = await previewTeamWorkspaceGhlLocationAction(clientAccountId, locationId, refresh);
      if (result.preview?.locationId === locationId) {
        setPreviews((current) => ({ ...current, [locationId]: result.preview as GhlLocationPreview }));
        setPreviewNote(null);
      } else {
        setPreviewNote(result.message ?? "The snapshot could not be read. Nothing was stored.");
      }
    } catch {
      setPreviewNote("The snapshot could not be read. Retry the snapshot. Nothing was stored.");
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }

  async function reload(mode: "manual" | "reconcile" | "after-save", expectedRequestId?: string) {
    if (inflight.current) return;
    inflight.current = true;
    setPending("Reloading the stored configuration request…");
    try {
      const result = await loadTeamWorkspaceGhlConfigurationAction(clientAccountId);
      if (!result.ok || !result.head) {
        setHold({ kind: "reload" });
        setMessage(result.message ?? "The configuration request could not be read. Retry the read before another request.");
        return;
      }
      setHead(result.head);
      setDisabled(false);
      const matched = Boolean(expectedRequestId && result.head.configuration?.requestId === expectedRequestId);
      if (mode === "after-save") {
        dirtyRef.current = false;
        setDraft(draftFromStoredRequest(result.head.configuration));
        setReplaceConfirmed(false);
        setHold(null);
        setMessage(
          matched
            ? "The configuration request was stored. The operational destination was not changed."
            : "The save was confirmed, and the stored request on file is shown below. The operational destination was not changed."
        );
        return;
      }
      if (mode === "reconcile") {
        setHold(null);
        if (matched) {
          dirtyRef.current = false;
          setDraft(draftFromStoredRequest(result.head.configuration));
          setReplaceConfirmed(false);
          setMessage("The earlier request is stored. The operational destination was not changed.");
        } else {
          setMessage("The earlier request was not stored. Review these choices and submit a new request when you are ready.");
        }
        return;
      }
      setHold(null);
      const keptEdits = dirtyRef.current;
      if (!keptEdits) {
        setDraft(draftFromStoredRequest(result.head.configuration));
        setReplaceConfirmed(false);
      }
      setMessage(
        keptEdits
          ? "The stored configuration request was reloaded. Unsaved choices were kept."
          : "The stored configuration request was reloaded."
      );
    } catch {
      setHold({ kind: "reload" });
      setMessage("The configuration request could not be read. Retry the read before another request.");
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }

  async function send(body: GhlConfigSubmitBody) {
    if (inflight.current) return;
    inflight.current = true;
    setPending("Saving the configuration request…");
    try {
      const result = await saveTeamWorkspaceGhlConfigurationRequestAction({ clientAccountId, ...body });
      await finishSave(result, body);
    } catch {
      setHold({ kind: "submit", body });
      setMessage(
        "The configuration request did not finish. Retry uses the same request id and the same payload. Nothing on this page was marked stored."
      );
    } finally {
      inflight.current = false;
      setPending(null);
    }
  }

  async function finishSave(result: GhlConfigSaveResult, body: GhlConfigSubmitBody) {
    const sent = result.sent ?? body;
    if (result.uncertain || result.retainRequestId) {
      setHold({ kind: "submit", body: sent });
      setMessage(result.message);
      return;
    }
    if (result.needsReload) {
      setHold({ kind: "reload" });
      setMessage(result.message);
      return;
    }
    if (!result.stored) {
      setHold(null);
      setMessage(result.message);
      return;
    }
    setMessage(result.message);
    inflight.current = false;
    await reload("after-save", result.requestId ?? sent.requestId);
  }

  function submit() {
    if (hold?.kind === "submit") {
      setMessage("An earlier request is still unconfirmed. Retry that request before starting another.");
      return;
    }
    if (hold?.kind === "reload") {
      setMessage("Reload the stored configuration request before starting another.");
      return;
    }
    if (stored && !replaceConfirmed) {
      setMessage("A configuration request is already stored. Confirm replacement before submitting another.");
      return;
    }
    if (!head || !review.canSubmit) {
      setMessage(review.blockers[0] ?? "The configuration request is incomplete. Nothing was stored.");
      return;
    }
    const requestId = globalThis.crypto?.randomUUID?.();
    if (!requestId) {
      setMessage("A request id could not be created. Reload and try again. Nothing was submitted.");
      return;
    }
    const body = buildGhlConfigSubmitBody({ requestId, head, draft });
    if (!body) {
      setMessage("The configuration request is incomplete. Nothing was submitted.");
      return;
    }
    void send(body);
  }

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="GoHighLevel configuration request" aria-busy={Boolean(pending)}>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">Configuration request</h3>
        <p className="text-sm text-slate-600">
          Choose a connected location, a workflow id, and explicit custom-field ids. Saving stores an intended request.
          It does not change the operational destination, enroll a lead, or turn delivery on.
        </p>
      </div>
      {pending ? (
        <p className="text-sm text-slate-600" role="status">
          {pending}
        </p>
      ) : null}
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Configuration request progress">
        {steps.map((step) => (
          <li key={step.id} data-config-step={step.id} data-state={step.state} className={`rounded-md border px-3 py-2 ${STEP_CLASS[step.state]}`}>
            <div className="text-sm font-medium">{step.label}</div>
            <p className="mt-1 text-sm">{step.detail}</p>
          </li>
        ))}
      </ol>
      <OperationalReadout operational={operational} />
      <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
        <Fact term="Request-chain revision" value={head ? String(head.revision) : "Not loaded"} />
        <Fact term="Stored request" value={stored ? `${stored.requestId} · revision ${stored.revision}` : head ? "None" : "Not loaded"} />
        <Fact term="Operational destination time" value={head ? formatGhlConfigTimestamp(head.destinationUpdatedAt) ?? "No operational destination" : "Not loaded"} />
      </dl>
      {stored ? (
        <p className="text-sm text-slate-700">
          The stored request is revision {stored.revision} for location {stored.locationId} and workflow id {stored.workflowId}. It is awaiting operational application.
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-amber-800" role="status">
          {message}
        </p>
      ) : null}
      {!disabled ? (
        <div className="grid gap-4">
          {head?.liveDestination || operational?.live ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
              A live operational destination already exists. This page will not store a configuration request over it, and it will not change that destination.
            </p>
          ) : null}
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-950" htmlFor="ghl-request-location-search">
              Connected locations
            </label>
            {locationsState === "loading" ? <p className="text-sm text-slate-600">Loading linked locations…</p> : null}
            {locationsState === "unavailable" ? (
              <p className="text-sm text-slate-600">Linked locations could not be read, so a location cannot be chosen yet.</p>
            ) : null}
            {locationsState === "ready" && connected.length === 0 ? (
              <p className="text-sm text-amber-800" role="status">
                No connected GoHighLevel location is linked to this client. Connect the location before choosing it here. This page does not link a client.
              </p>
            ) : null}
            {locationsState === "ready" && connected.length > 0 ? (
              <Input
                id="ghl-request-location-search"
                value={query}
                placeholder="Search connected locations"
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : null}
            {locationsState === "ready" && connected.length > 0 && visibleLocations.length === 0 ? (
              <p className="text-sm text-slate-600">No connected location matches that search.</p>
            ) : null}
            {visibleLocations.length > 0 ? (
              <ul className="grid gap-2">
                {visibleLocations.map((location) => (
                  <li key={location.connectionId}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${draft.locationId === location.locationId ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}
                      aria-pressed={draft.locationId === location.locationId}
                      disabled={locked}
                      onClick={() => chooseLocation(location.locationId)}
                    >
                      <span className="font-medium text-slate-950">{location.locationName ?? location.locationId}</span>
                      <span className="mt-1 block text-slate-600">{location.locationId} · connected · not saved yet</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {disconnected.length > 0 ? (
              <ul className="grid gap-2" aria-label="Disconnected locations">
                {disconnected.map((location) => (
                  <li key={location.connectionId} className="rounded-md border border-amber-200 px-3 py-2 text-sm text-amber-950">
                    {location.locationName ?? location.locationId} ({location.locationId}) is {location.connectionStatus}.
                    {location.lastError ? ` ${location.lastError}` : ""} This page does not link a client.
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm text-slate-600">{review.locationDetail}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={locked || !draft.locationId} onClick={() => void readSnapshot(false)}>
              Load snapshot
            </Button>
            <Button type="button" variant="outline" disabled={locked || !draft.locationId} onClick={() => void readSnapshot(true)}>
              Refresh snapshot
            </Button>
            <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={() => void reload(hold?.kind === "submit" ? "reconcile" : "manual", hold?.kind === "submit" ? hold.body.requestId : undefined)}>
              Reload the configuration request
            </Button>
          </div>
          {previewNote ? (
            <p className="text-sm text-amber-800" role="status">
              {previewNote}
            </p>
          ) : null}
          <p className="text-sm text-slate-600" data-preview-location={preview?.locationId ?? ""}>
            {preview ? review.snapshotDetail : "No snapshot is loaded for the selected location."}
          </p>
          {review.webformNote ? <p className="text-sm text-slate-600">{review.webformNote}</p> : null}
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-950" htmlFor="ghl-request-workflow">
              Workflow id
            </label>
            <Select
              id="ghl-request-workflow"
              value={draft.workflowId}
              disabled={locked || !draft.locationId}
              onChange={(event) => edit({ ...draft, workflowId: event.target.value })}
            >
              <option value="">Choose a workflow id</option>
              {draft.workflowId && !preview?.workflows.some((workflow) => workflow.id === draft.workflowId) ? (
                <option value={draft.workflowId}>{draft.workflowId} · not in this snapshot</option>
              ) : null}
              {(preview?.workflows ?? []).map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} · {workflow.id}
                </option>
              ))}
            </Select>
            <p className="text-sm text-slate-600">{review.workflowDetail}</p>
          </div>
          <FieldGroups
            rows={review.rows.filter((row) => row.required)}
            title="Survey field ids"
            draft={draft}
            preview={preview}
            locked={locked}
            onChange={(key, fieldId) => edit({ ...draft, mappings: { ...draft.mappings, [key]: fieldId } })}
          />
          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-950">SA360 field ids</summary>
            <div className="mt-3">
              <FieldGroups
                rows={review.rows.filter((row) => !row.required)}
                title="Optional SA360 mappings"
                draft={draft}
                preview={preview}
                locked={locked}
                onChange={(key, fieldId) => edit({ ...draft, mappings: { ...draft.mappings, [key]: fieldId } })}
              />
            </div>
          </details>
          <div className="grid gap-2 rounded-md border border-slate-200 p-3" aria-label="Configuration request summary">
            <h4 className="text-sm font-medium text-slate-950">Review before saving</h4>
            {dirtyRef.current || draft.locationId ? <p className="text-sm text-slate-600">Choices below are not saved until the request succeeds.</p> : null}
            <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <Fact term="Location" value={draft.locationId || "Not chosen"} />
              <Fact term="Workflow id" value={draft.workflowId || "Not chosen"} />
              {review.rows
                .filter((row) => row.required || row.fieldId)
                .map((row) => (
                  <Fact key={row.key} term={row.label} value={row.fieldId ? `${row.fieldId} · ${row.status.replaceAll("_", " ")}` : row.status.replaceAll("_", " ")} />
                ))}
            </dl>
            {review.blockers.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {review.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">The summary is ready to submit. The backend still checks it.</p>
            )}
            {stored ? (
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={replaceConfirmed}
                  disabled={locked}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
                Replace the stored configuration request. The operational destination stays unchanged.
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" disabled={!canSave} onClick={submit}>
              {pending && pending.startsWith("Saving") ? "Saving…" : "Save configuration request"}
            </Button>
            {hold?.kind === "submit" ? (
              <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={() => void send(hold.body)}>
                Retry the same configuration request
              </Button>
            ) : null}
            {stored ? (
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => {
                  if (!stored) return;
                  dirtyRef.current = false;
                  setDraft(draftFromStoredRequest(stored));
                  setReplaceConfirmed(false);
                }}
              >
                Use the stored request
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FieldGroups({
  rows,
  title,
  draft,
  preview,
  locked,
  onChange,
}: {
  rows: ReturnType<typeof reviewGhlConfigDraft>["rows"];
  title: string;
  draft: GhlConfigDraft;
  preview: GhlLocationPreview | null;
  locked: boolean;
  onChange: (key: string, fieldId: string) => void;
}) {
  const known = new Set(preview?.fields.map((field) => field.id) ?? []);
  return (
    <div className="grid gap-3">
      <h4 className="text-sm font-medium text-slate-950">{title}</h4>
      {rows.map((row) => {
        const current = draft.mappings[row.key]?.trim() || "";
        return (
          <div key={row.key} className="grid gap-1">
            <label className="text-sm text-slate-800" htmlFor={`ghl-request-field-${row.key}`}>
              {row.label}
              {row.required ? "" : " (optional)"}
            </label>
            <Select
              id={`ghl-request-field-${row.key}`}
              value={current}
              disabled={locked || !draft.locationId}
              onChange={(event) => onChange(row.key, event.target.value)}
            >
              <option value="">Not mapped</option>
              {current && !known.has(current) ? <option value={current}>{current} · not in this snapshot</option> : null}
              {(preview?.fields ?? []).map((field, index) => (
                <option key={`${field.id}-${index}`} value={field.id}>
                  {field.name} · {field.id}
                </option>
              ))}
            </Select>
            <p className="text-sm text-slate-600">{row.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

function OperationalReadout({ operational }: { operational: OperationalDestinationStatus | null }) {
  if (!operational) {
    return <p className="text-sm text-slate-600">The operational destination has not been read on this page.</p>;
  }
  return (
    <p className="text-sm text-slate-700">
      Operational destination: {operational.configured ? "Configured" : "Not configured"}. Verification:{" "}
      {operational.verified ? "Verified" : "Not verified"}. Delivery: {operational.active ? "Active" : "Not active"}. A
      configuration request is not an active or verified operational destination.
    </p>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{term}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
