"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeGhlDeliveryPreview } from "@/lib/clients/onboarding/ghl-delivery-preview";
import type { SelectableLead } from "@/lib/clients/onboarding/view";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "@/lib/ghl-live-canary/types";
import type { RoutingRuleGhlConfigSaveBody } from "@/lib/ghl-config/types";

import { StatusMark } from "./status-mark";
import type {
  GhlWalkthroughActions,
  GhlWalkthroughConnection,
  GhlWalkthroughExecution,
  GhlWalkthroughLocation,
  GhlWalkthroughPreflight,
  GhlWalkthroughPreview,
} from "./ghl-walkthrough-types";

type TriggerMode = "direct_api" | "tag_trigger" | "none";

function triggerModeValue(value: string | null | undefined): TriggerMode {
  if (value === "direct_api" || value === "tag_trigger" || value === "none") return value;
  return "tag_trigger";
}

function deliveryWord(enabled: boolean | null): "yes" | "no" | "unknown" {
  if (enabled === true) return "yes";
  if (enabled === false) return "no";
  return "unknown";
}

export function GhlWalkthroughPanel({
  clientAccountId,
  leads,
  location,
  connections,
  sheetsCampaignEnabled,
  locationError = null,
  actions,
}: {
  clientAccountId: string;
  leads: SelectableLead[];
  location: GhlWalkthroughLocation | null;
  connections: GhlWalkthroughConnection[];
  sheetsCampaignEnabled: boolean | null;
  locationError?: string | null;
  actions: GhlWalkthroughActions;
}) {
  const [locationRows, setLocationRows] = useState(connections);
  const [selectedLocationId, setSelectedLocationId] = useState(location?.locationId ?? "");
  const [savedLocationId, setSavedLocationId] = useState(location?.locationId ?? "");
  const [savedLocationName, setSavedLocationName] = useState(location?.locationName ?? null);
  const [workflowId, setWorkflowId] = useState(location?.workflowId ?? "");
  const [savedWorkflowId, setSavedWorkflowId] = useState(location?.workflowId ?? "");
  const [triggerMode, setTriggerMode] = useState<TriggerMode>(triggerModeValue(location?.workflowTriggerMode));
  const [savedTriggerMode, setSavedTriggerMode] = useState(location?.workflowTriggerMode ?? null);
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean | null>(location?.deliveryEnabled ?? null);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [fieldMapping, setFieldMapping] = useState<GhlWalkthroughPreview["fieldMapping"]>(null);
  const [discoveryFields, setDiscoveryFields] = useState<RoutingRuleGhlConfigSaveBody["discoveryCustomFields"]>();
  const [discoveredMap, setDiscoveredMap] = useState<Record<string, string> | undefined>();
  const [eventId, setEventId] = useState(leads[0]?.sourceLeadEventId ?? "");
  const [preview, setPreview] = useState<GhlWalkthroughPreview | null>(null);
  const [preflight, setPreflight] = useState<GhlWalkthroughPreflight | null>(null);
  const [execution, setExecution] = useState<GhlWalkthroughExecution | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const selectedConnection = locationRows.find((row) => row.locationId === selectedLocationId) ?? null;
  const linkedHere = selectedConnection?.clientAccountId === clientAccountId;
  const linkedElsewhere = Boolean(selectedConnection?.clientAccountId && !linkedHere);
  const savedLocationDiffers = Boolean(savedLocationId && selectedLocationId && selectedLocationId !== savedLocationId);
  const selectedWorkflow = workflows.find((item) => item.id === workflowId) ?? null;
  const workflowKnown = workflows.length === 0 ? Boolean(savedWorkflowId && workflowId === savedWorkflowId) : Boolean(selectedWorkflow);
  const lead = leads.find((item) => item.sourceLeadEventId === eventId) ?? null;
  const facts = useMemo(() => {
    if (!preview) return null;
    return describeGhlDeliveryPreview({
      steps: preview.steps,
      fieldMapping: preview.fieldMapping ?? fieldMapping,
      workflowId: selectedWorkflow?.id ?? savedWorkflowId ?? null,
      workflowName: selectedWorkflow?.name ?? null,
      workflowTriggerMode: savedTriggerMode,
      opportunityCreationEnabled: location?.opportunityCreationEnabled ?? null,
      adapterRunId: preview.runId,
    });
  }, [fieldMapping, location?.opportunityCreationEnabled, preview, savedTriggerMode, savedWorkflowId, selectedWorkflow]);
  const uncertain = /uncertain|executing/i.test(preflight?.lastLiveRunStatus ?? "") || /uncertain/i.test(execution?.status ?? "");
  const duplicateBlocked = preflight?.duplicateBlocksLive === true || execution?.skippedDuplicate === true;
  const canExecute =
    Boolean(preview?.planId) &&
    preflight?.canExecute === true &&
    !duplicateBlocked &&
    !uncertain &&
    confirmText.trim() === LIVE_CANARY_CONFIRMATION_TEXT;

  async function refreshLocations() {
    setPending("locations");
    setError(null);
    const result = await actions.loadConnections();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLocationRows(result.items);
  }

  async function linkSelected() {
    if (!selectedConnection) return;
    setPending("link");
    setError(null);
    const result = await actions.linkLocation(selectedConnection.id);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLocationRows((rows) =>
      rows.map((row) => (row.id === selectedConnection.id ? { ...row, clientAccountId } : row))
    );
  }

  async function connect() {
    setPending("connect");
    setError(null);
    const result = await actions.startConnect();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAuthorizeUrl(result.authorizeUrl);
  }

  async function discover() {
    if (!selectedLocationId) return;
    setPending("discover");
    setError(null);
    const result = await actions.discover(selectedLocationId);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setWorkflows(result.discovery.workflows.map((item) => ({ id: item.id, name: item.name })));
    setFieldMapping({
      coreRequiredMapped: result.discovery.sa360FieldMapping.coreRequiredMapped,
      coreRequiredMissing: result.discovery.sa360FieldMapping.coreRequiredMissing,
      optionalMissing: result.discovery.sa360FieldMapping.optionalMissing,
    });
    setDiscoveryFields(result.discovery.customFields);
    setDiscoveredMap(result.discovery.sa360FieldMapping.discoveredMap);
  }

  async function saveWorkflow() {
    if (!selectedLocationId || !selectedWorkflow) return;
    setPending("save");
    setError(null);
    const body: RoutingRuleGhlConfigSaveBody = {
      locationId: selectedLocationId,
      destinationWorkflowIdGhl: selectedWorkflow.id,
      destinationPipelineIdGhl: location?.pipelineId ?? null,
      destinationPipelineStageIdGhl: location?.stageId ?? null,
      workflowTriggerMode: triggerMode,
      discoveryCustomFields: discoveryFields,
      sa360CustomFieldIdMapJson: discoveredMap,
    };
    if (triggerMode === "direct_api") body.workflowStartRequired = true;
    const result = await actions.saveWorkflow(body);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedTriggerMode(result.workflowTriggerMode);
    setDeliveryEnabled(result.deliveryEnabled);
    setSavedLocationId(selectedLocationId);
    setSavedLocationName(selectedConnection?.locationName ?? savedLocationName);
    if (result.workflowId) {
      setWorkflowId(result.workflowId);
      setSavedWorkflowId(result.workflowId);
    }
  }

  async function previewDelivery() {
    if (!lead?.routingDryRunDecisionId) return;
    setPending("preview");
    setError(null);
    setExecution(null);
    setConfirmOpen(false);
    setConfirmText("");
    const result = await actions.previewDelivery(lead.routingDryRunDecisionId);
    setPending(null);
    if (!result.ok) {
      setPreview(null);
      setPreflight(null);
      setError(result.error);
      return;
    }
    setPreview(result.preview);
    if (result.preview.deliveryEnabled !== null) setDeliveryEnabled(result.preview.deliveryEnabled);
    const ready = await actions.loadPreflight(result.preview.planId);
    if (!ready.ok) {
      setError(ready.error);
      return;
    }
    setPreflight(ready.preflight);
  }

  async function execute() {
    if (!preview?.planId || !canExecute) return;
    setPending("execute");
    setError(null);
    const result = await actions.executeTest(preview.planId, confirmText.trim());
    setPending(null);
    if (result.result) setExecution(result.result);
    if (!result.ok) {
      setError(result.error);
      if (result.blockers?.length) {
        setPreflight((current) =>
          current ? { ...current, canExecute: false, blockers: result.blockers ?? current.blockers } : current
        );
      }
    } else {
      setConfirmOpen(false);
    }
    const ready = await actions.loadPreflight(preview.planId);
    if (ready.ok) setPreflight(ready.preflight);
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="ghl-walkthrough">
      <div>
        <h2 className="text-base font-semibold text-slate-900">GHL location and workflow</h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick the connected location and the workflow id from that location. The workflow does not have to be named
          Select Time Zone. Saving it does not turn on ongoing delivery.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>
          <Link href="/clients" className="text-sky-700 hover:underline">
            Clients
          </Link>
          , then Create client, or open this client.
        </li>
        <li>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}`} className="text-sky-700 hover:underline">
            Client detail
          </Link>
          . Page URL or slug, then Associate source, then Confirm association.
        </li>
        <li>Google Sheets on this page: link the copied spreadsheet and the existing tab.</li>
        <li>Test console: Preview stored lead, and compare that lead with the worksheet headers.</li>
        <li>Test console shows the Sheets attempt. It does not enable Sheets.</li>
        <li>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}/google-sheets`} className="text-sky-700 hover:underline">
            Google Sheets
          </Link>
          . Enable campaign delivery only when the Sheets test looks right.
        </li>
        <li>Connect a GHL location or select the location already stored here.</li>
        <li>Discover workflows, choose the workflow id and trigger mode, then Save selected workflow.</li>
        <li>Preview GHL delivery for the same stored lead.</li>
        <li>Run one GHL test only after typing the confirmation. One attempt is shown below.</li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark
          label="Sheets campaign delivery"
          state={deliveryWord(sheetsCampaignEnabled)}
          detail="Independent of GHL. Enable campaign delivery is on the Google Sheets page."
        />
        <StatusMark
          label="GHL ongoing delivery"
          state={deliveryWord(deliveryEnabled)}
          detail="Independent of Sheets. A test on this page does not change this switch."
        />
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="font-medium">Connected location. </span>
          {savedLocationName || "not loaded"}
        </p>
        <p className="font-mono text-xs">{savedLocationId || "no location id"}</p>
        <p>
          <span className="font-medium">Saved trigger mode. </span>
          {savedTriggerMode ?? "unset"}
        </p>
        <p>
          <span className="font-medium">Saved workflow id. </span>
          <span className="font-mono text-xs">{savedWorkflowId || "unset"}</span>
        </p>
      </div>
      {locationError ? (
        <p className="text-sm text-amber-900" role="status">
          {locationError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void refreshLocations()}>
          {pending === "locations" ? "Refreshing locations…" : "Refresh locations"}
        </Button>
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void connect()}>
          {pending === "connect" ? "Starting connect…" : "Connect a GHL location"}
        </Button>
      </div>
      {authorizeUrl ? (
        <p className="text-sm">
          <a href={authorizeUrl} className="text-sky-700 hover:underline">
            Open HighLevel connect
          </a>
        </p>
      ) : null}
      <Label className="block text-sm">
        GHL location
        <select
          className="mt-1 h-8 w-full max-w-xl rounded-lg border border-slate-200 bg-white px-2 text-sm"
          aria-label="GHL location"
          value={selectedLocationId}
          onChange={(event) => {
            const id = event.target.value;
            setSelectedLocationId(id);
            setWorkflows([]);
          }}
        >
          <option value="">Select a location</option>
          {location?.locationId && !locationRows.some((row) => row.locationId === location.locationId) ? (
            <option value={location.locationId}>{location.locationName || location.locationId}</option>
          ) : null}
          {locationRows.map((row) => (
            <option key={row.id} value={row.locationId}>
              {row.locationName || "Unnamed location"} · {row.locationId}
              {row.clientAccountId === clientAccountId ? " · linked here" : ""}
            </option>
          ))}
        </select>
      </Label>
      {selectedConnection && !linkedHere && !linkedElsewhere ? (
        <Button type="button" size="sm" variant="outline" disabled={pending !== null} onClick={() => void linkSelected()}>
          {pending === "link" ? "Linking location…" : `Link ${selectedConnection.locationName || "this location"}`}
        </Button>
      ) : null}
      {linkedElsewhere ? (
        <p className="text-sm text-amber-900">
          This location is linked to {selectedConnection?.clientAccountId}. This screen will not move it.
        </p>
      ) : null}
      {savedLocationDiffers ? (
        <p className="text-sm text-amber-900">
          The saved location is {savedLocationId}. This screen will not replace it.
        </p>
      ) : null}
      <Button type="button" variant="outline" disabled={pending !== null || !selectedLocationId} onClick={() => void discover()}>
        {pending === "discover" ? "Discovering workflows…" : "Discover workflows"}
      </Button>
      {workflows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="block text-sm">
            Workflow
            <select
              className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
              aria-label="Workflow"
              value={selectedWorkflow ? workflowId : ""}
              onChange={(event) => setWorkflowId(event.target.value)}
            >
              <option value="">Select a workflow id</option>
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.id}
                </option>
              ))}
            </select>
          </Label>
          <Label className="block text-sm">
            Workflow id
            <Input
              aria-label="Workflow id"
              className="mt-1 font-mono"
              value={workflowId}
              onChange={(event) => setWorkflowId(event.target.value.trim())}
            />
          </Label>
          <Label className="block text-sm">
            Trigger mode
            <select
              className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
              aria-label="Trigger mode"
              value={triggerMode}
              onChange={(event) => setTriggerMode(event.target.value as TriggerMode)}
            >
              <option value="direct_api">direct_api</option>
              <option value="tag_trigger">tag_trigger</option>
              <option value="none">none</option>
            </select>
          </Label>
          <p className="text-xs text-slate-600 sm:col-span-2">
            direct_api enrolls the selected workflow id. tag_trigger adds the destination workflow tag and does not call
            that id. none does not start a workflow.
          </p>
        </div>
      ) : null}
      {!workflowKnown && workflowId && workflows.length > 0 ? (
        <p className="text-sm text-amber-900">That id is not in this location&apos;s workflow list. It was not saved.</p>
      ) : null}
      <Button
        type="button"
        disabled={pending !== null || !selectedWorkflow || linkedElsewhere || savedLocationDiffers}
        onClick={() => void saveWorkflow()}
      >
        {pending === "save" ? "Saving workflow…" : "Save selected workflow"}
      </Button>
      <p className="text-xs text-slate-600">
        Save selected workflow writes the workflow id and trigger mode on this client. It does not set ongoing delivery.
      </p>

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">GHL test for this stored lead</h3>
        <p className="text-sm text-slate-600">
          Preview uses the existing delivery-plan simulation. It is stored and sends nothing. Run one GHL test uses the
          existing live canary and does not change GHL ongoing delivery.
        </p>
        {leads.length === 0 ? (
          <p className="text-sm text-slate-600">No stored lead is on the source proof.</p>
        ) : (
          <Label className="block text-sm">
            Stored lead for GHL
            <select
              className="mt-1 h-8 w-full max-w-xl rounded-lg border border-slate-200 bg-white px-2 text-sm"
              aria-label="Stored lead for GHL"
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
            >
              {leads.map((item) => (
                <option key={item.sourceLeadEventId} value={item.sourceLeadEventId}>
                  {item.sourceLeadEventId} · {item.identity}
                </option>
              ))}
            </select>
          </Label>
        )}
        {!lead?.routingDryRunDecisionId && lead ? (
          <p className="text-sm text-amber-900">
            This stored lead has no routing decision, so a GHL delivery plan cannot be built from here.
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null || !lead?.routingDryRunDecisionId}
          onClick={() => void previewDelivery()}
        >
          {pending === "preview" ? "Previewing GHL delivery…" : "Preview GHL delivery"}
        </Button>
        {facts ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid="ghl-delivery-preview">
            <p>
              <span className="font-medium">Contact. </span>
              {facts.contact}
            </p>
            <p>
              <span className="font-medium">Workflow enrollment. </span>
              {facts.workflow}
            </p>
            <p>
              <span className="font-medium">Field mapping. </span>
              {facts.fieldMapping}
            </p>
            <p>
              <span className="font-medium">Opportunity. </span>
              {facts.opportunity}
            </p>
            <p>{facts.persistedSimulation}</p>
            <p>Ongoing delivery changed: {facts.ongoingDeliveryChanged ? "yes" : "no"}.</p>
          </div>
        ) : null}
        {preflight ? (
          <div className="space-y-1 text-sm">
            <p>Can execute: {preflight.canExecute ? "yes" : "no"}.</p>
            {preflight.duplicateRiskLevel ? <p>Duplicate risk: {preflight.duplicateRiskLevel}.</p> : null}
            {preflight.duplicateBlocksLive ? (
              <p className="text-amber-900">Duplicate risk blocks another send. This screen will not send it again.</p>
            ) : null}
            {preflight.blockers.length > 0 ? (
              <ul className="list-disc pl-5 text-amber-900">
                {preflight.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-slate-600">
              If a blocker says ongoing delivery must be on, leave it off. This test will not turn that switch on.
            </p>
          </div>
        ) : null}
        {uncertain ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="ghl-outcome-uncertain">
            The last GHL attempt is uncertain or still running. It is not sent again from this screen.
          </p>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          disabled={!preview?.planId || !preflight?.canExecute || pending !== null || duplicateBlocked || uncertain}
          onClick={() => setConfirmOpen(true)}
        >
          Run one GHL test
        </Button>
        {confirmOpen ? (
          <div className="space-y-2 rounded-lg border border-slate-300 p-3">
            <p className="text-sm">
              Type <span className="font-mono font-semibold">{LIVE_CANARY_CONFIRMATION_TEXT}</span> to send one lead.
              This does not enable ongoing delivery.
            </p>
            <Input
              aria-label="GHL test confirmation"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={!canExecute || pending !== null} onClick={() => void execute()}>
                {pending === "execute" ? "Executing one GHL test…" : "Execute one GHL test"}
              </Button>
            </div>
          </div>
        ) : null}
        {execution ? (
          <div className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="ghl-test-result">
            <p>Attempt status: {execution.status}.</p>
            <p>External call: {execution.externalCallExecuted ? "yes" : "no"}.</p>
            <p>Contact id: {execution.contactIdGhl ?? "none"}.</p>
            <p>Workflow started: {execution.workflowStarted ? "yes" : "no"}.</p>
            <p>Opportunity id: {execution.opportunityIdGhl ?? "none"}.</p>
            <p>Ongoing delivery changed: no.</p>
            {execution.errors.length > 0 ? <p>{execution.errors.join(" ")}</p> : null}
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-amber-900" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
