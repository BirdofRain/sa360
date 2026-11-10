"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkTeamWorkspaceGhlConnectionAction,
  loadTeamWorkspaceGhlDestinationAction,
  readTeamWorkspaceGhlSnapshotAction,
  type GuidedGhlActionResult,
} from "@/app/actions/team-workspace-ghl-destination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GUIDED_GHL_WRITE_BLOCK,
  ghlDestinationChanged,
  type GuidedGhlDestinationView,
} from "@/lib/team-workspace/ghl-destination";

const BADGE = {
  on: "border-sky-200 bg-sky-50 text-sky-950",
  off: "border-slate-200 bg-white text-slate-600",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
} as const;

export function GhlDestinationGuide({ clientAccountId }: { clientAccountId: string }) {
  const [view, setView] = useState<GuidedGhlDestinationView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState<string | null>("Loading the saved GoHighLevel destination…");
  const seenUpdatedAt = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [workflowQuery, setWorkflowQuery] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [highlightedWorkflowId, setHighlightedWorkflowId] = useState("");
  const [retry, setRetry] = useState<null | (() => void)>(null);

  function apply(result: GuidedGhlActionResult, replaceSeen: boolean) {
    if (result.view) {
      setView(result.view);
      setSelectedLocationId((current) => current || result.view?.locationId || result.view?.locations[0]?.locationId || "");
      setHighlightedWorkflowId((current) => current || result.view?.workflowId || "");
      if (replaceSeen) seenUpdatedAt.current = result.view.updatedAt;
      else setStale(ghlDestinationChanged(seenUpdatedAt.current, result.view.updatedAt));
    }
    setUncertain(result.view?.uncertain === true || (!result.ok && result.code === "UNCERTAIN"));
    setMessage(result.ok ? null : result.message);
  }

  async function run(label: string, work: () => Promise<GuidedGhlActionResult>, replaceSeen: boolean) {
    setPending(label);
    setRetry(() => () => void run(label, work, replaceSeen));
    try {
      apply(await work(), replaceSeen);
    } catch {
      setMessage("The destination could not be read. Nothing was written.");
      setUncertain(true);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setPending("Loading the saved GoHighLevel destination…");
      setRetry(() => () => load());
      void loadTeamWorkspaceGhlDestinationAction(clientAccountId)
        .then((result) => {
          if (cancelled) return;
          apply(result, true);
        })
        .catch(() => {
          if (cancelled) return;
          setMessage("You do not have permission to read this GoHighLevel destination.");
          setUncertain(true);
        })
        .finally(() => {
          if (!cancelled) setPending(null);
        });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [clientAccountId]);

  const locations = useMemo(() => {
    const query = locationQuery.trim().toLowerCase();
    return (view?.locations ?? []).filter((location) => {
      if (!query) return true;
      return `${location.locationName ?? ""} ${location.locationId} ${location.connectionStatus}`.toLowerCase().includes(query);
    });
  }, [locationQuery, view?.locations]);
  const workflows = useMemo(() => {
    const query = workflowQuery.trim().toLowerCase();
    return (view?.workflows ?? []).filter((workflow) => {
      if (!query) return true;
      return `${workflow.name} ${workflow.id}`.toLowerCase().includes(query);
    });
  }, [view?.workflows, workflowQuery]);

  const highlighted = view?.workflows.find((workflow) => workflow.id === highlightedWorkflowId) ?? null;
  const workflowChoiceNote =
    !highlighted || !view?.workflowId
      ? null
      : highlighted.id === view.workflowId
        ? "This is the saved workflow id."
        : "This workflow is not the saved workflow id. Choosing it here does not save it.";

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="GoHighLevel destination guide">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">GoHighLevel destination</h3>
        <p className="text-sm text-slate-600">
          Review the saved location, workflow, and field ids. Configured means a destination row is saved. Verified means
          those saved ids match the location snapshot. Active means live delivery is already authorized. This guide does
          not turn delivery on, enroll a lead, or change Company Sheets.
        </p>
      </div>
      {pending ? <p className="text-sm text-slate-600">{pending}</p> : null}
      {view ? (
        <div className="flex flex-wrap gap-2" aria-label="Destination status">
          <StatusBadge on={view.configured} label={view.configured ? "Configured" : "Not configured"} />
          <StatusBadge on={view.verified} label={view.verified ? "Verified" : "Not verified"} />
          <StatusBadge on={view.active} label={view.active ? "Active" : "Not active"} warn={view.active} />
        </div>
      ) : null}
      {view?.availability === "ready" ? <SavedSummary view={view} /> : null}
      {view ? <Progress view={view} /> : null}
      {stale ? (
        <p className="text-sm text-amber-800" role="status">
          The saved destination changed after this page was opened. This view was reloaded. Nothing was written from the
          earlier view.
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-amber-800" role="status">
          {uncertain ? "The last read could not be confirmed. " : ""}
          {message}
        </p>
      ) : null}
      {uncertain && retry ? (
        <div>
          <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={retry}>
            Retry the last read
          </Button>
        </div>
      ) : null}
      {view?.availability === "ready" ? (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-950" htmlFor="ghl-location-search">
              Linked locations
            </label>
            <Input
              id="ghl-location-search"
              value={locationQuery}
              placeholder="Search locations"
              onChange={(event) => setLocationQuery(event.target.value)}
            />
            {locations.length === 0 ? (
              <p className="text-sm text-slate-600">No linked location matches that search.</p>
            ) : (
              <ul className="grid gap-2">
                {locations.map((location) => (
                  <li key={location.connectionId}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedLocationId === location.locationId ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}
                      onClick={() => setSelectedLocationId(location.locationId)}
                    >
                      <span className="font-medium text-slate-950">{location.locationName ?? location.locationId}</span>
                      <span className="mt-1 block text-slate-600">
                        {location.locationId} · {location.connectionStatus}
                        {location.saved ? " · saved destination" : " · not the saved destination"}
                      </span>
                      {location.lastError ? <span className="mt-1 block text-amber-800">{location.lastError}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedLocationId && selectedLocationId !== view.locationId ? (
              <p className="text-sm text-amber-800">
                This location is not the saved destination. Reading it does not replace the saved location.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pending) || !selectedLocationId}
              onClick={() =>
                void run("Reading the saved location snapshot…", () =>
                  readTeamWorkspaceGhlSnapshotAction(clientAccountId, selectedLocationId, false)
                , false)
              }
            >
              Read location snapshot
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pending) || !selectedLocationId}
              onClick={() =>
                void run("Refreshing the location from GoHighLevel…", () =>
                  readTeamWorkspaceGhlSnapshotAction(clientAccountId, selectedLocationId, true)
                , false)
              }
            >
              Refresh from GoHighLevel
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pending) || view.live || !view.connectionId}
              onClick={() =>
                void run("Checking the linked credentials…", () =>
                  checkTeamWorkspaceGhlConnectionAction(clientAccountId, view.connectionId ?? "")
                , false)
              }
            >
              Check credentials
            </Button>
          </div>
          <p className="text-sm text-slate-600">
            Refresh stores a location snapshot. It does not change the destination or enroll a lead.
            {view.live ? " Credential checks are turned off because this destination is already live." : ""}
          </p>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-950" htmlFor="ghl-workflow-search">
              Workflows in the snapshot
            </label>
            <Input
              id="ghl-workflow-search"
              value={workflowQuery}
              placeholder="Search workflows"
              onChange={(event) => setWorkflowQuery(event.target.value)}
            />
            {view.snapshotLoaded && workflows.length === 0 ? (
              <p className="text-sm text-slate-600">No workflow in this snapshot matches that search.</p>
            ) : null}
            {!view.snapshotLoaded ? <p className="text-sm text-slate-600">Read the location snapshot to list workflows.</p> : null}
            {workflows.length > 0 ? (
              <ul className="grid max-h-56 gap-2 overflow-auto">
                {workflows.map((workflow) => (
                  <li key={workflow.id}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${highlightedWorkflowId === workflow.id ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}
                      onClick={() => setHighlightedWorkflowId(workflow.id)}
                    >
                      <span className="font-medium text-slate-950">{workflow.name}</span>
                      <span className="mt-1 block text-slate-600">
                        {workflow.id}
                        {workflow.saved ? " · saved workflow id" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {workflowChoiceNote ? <p className="text-sm text-slate-700">{workflowChoiceNote}</p> : null}
            {view.webformNote ? <p className="text-sm text-slate-600">{view.webformNote}</p> : null}
          </div>
          <FieldList title="Required survey mappings" rows={view.fields} />
          <FieldList title="Saved SA360 field ids" rows={view.stampFields} empty="No SA360 field ids are saved." />
          <IssueList issues={view.issues} />
        </div>
      ) : null}
      <p className="text-sm text-slate-600">{view?.writesBlocked ?? GUIDED_GHL_WRITE_BLOCK}</p>
      <p className="text-sm text-slate-600">
        LAL AI Bot-1 webform selection is not changed here. A matching field name is not a saved field id. This page does
        not add a tag or bypass workflow enrollment checks.
      </p>
    </section>
  );
}

function SavedSummary({ view }: { view: GuidedGhlDestinationView }) {
  return (
    <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
      <Fact term="Saved location" value={view.locationName ? `${view.locationName} (${view.locationId})` : view.locationId} />
      <Fact term="Credentials" value={view.connectionStatus} />
      <Fact term="Saved workflow" value={view.workflowName ? `${view.workflowName} (${view.workflowId})` : view.workflowId} />
      <Fact term="Workflow in snapshot" value={view.workflowInSnapshot === null ? "Not read" : view.workflowInSnapshot ? "Yes" : "No"} />
      <Fact term="Trigger mode" value={view.workflowTriggerMode} />
      <Fact term="Delivery mode" value={view.deliveryMode} />
      <Fact term="Delivery enabled" value={yesNo(view.deliveryEnabled)} />
      <Fact term="Cutover approved" value={yesNo(view.clientCutoverApproved)} />
      <Fact term="Internal approval" value={view.internalApprovalStatus} />
      <Fact term="Saved at" value={view.updatedAt} />
    </dl>
  );
}

function Progress({ view }: { view: GuidedGhlDestinationView }) {
  const steps = [
    {
      label: "Location",
      state: view.connectionStatus === "connected" && view.configured ? "complete" : "current",
      detail: view.locationId ? view.locationId : "Choose a linked location. Nothing is saved from this list.",
    },
    {
      label: "Workflow",
      state: view.workflowInSnapshot ? "complete" : view.workflowId ? "current" : "waiting",
      detail: view.workflowId ?? "No workflow id is saved.",
    },
    {
      label: "Field ids",
      state: view.fields.length > 0 && view.fields.every((field) => field.status === "verified") ? "complete" : "current",
      detail: "A saved field id is verified only when it equals a field id in the snapshot.",
    },
    {
      label: "Delivery",
      state: view.active ? "warn" : view.configured ? "complete" : "waiting",
      detail: view.active ? "Active. This page will not change it." : "Off. This page cannot turn it on.",
    },
  ] as const;
  return (
    <ol className="grid gap-2 sm:grid-cols-4">
      {steps.map((step) => (
        <li key={step.label} className="rounded-md border border-slate-200 p-3">
          <div className="text-sm font-medium text-slate-950">{step.label}</div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{step.state === "warn" ? "Active" : step.state}</div>
          <p className="mt-1 text-sm text-slate-600">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

function FieldList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: GuidedGhlDestinationView["fields"];
  empty?: string;
}) {
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-medium text-slate-950">{title}</h4>
      {rows.length === 0 ? <p className="text-sm text-slate-600">{empty ?? "Nothing to review yet."}</p> : null}
      {rows.length > 0 ? (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.key} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="font-medium text-slate-950">
                {row.label} · {row.status.replace("_", " ")}
              </div>
              <p className="text-slate-600">{row.savedId ? `Saved id ${row.savedId}. ` : ""}{row.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return <p className="text-sm text-slate-600">No outstanding destination issues were found.</p>;
  return (
    <div>
      <h4 className="text-sm font-medium text-slate-950">Outstanding issues</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{term}</dt>
      <dd>{value || "Not saved"}</dd>
    </div>
  );
}

function StatusBadge({ on, label, warn = false }: { on: boolean; label: string; warn?: boolean }) {
  const tone = warn && on ? BADGE.warn : on ? BADGE.on : BADGE.off;
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}

function yesNo(value: boolean | null): string | null {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}
