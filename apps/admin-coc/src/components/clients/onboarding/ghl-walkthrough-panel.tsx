"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CANONICAL_SURVEY_ATTRIBUTES,
  classifyGhlFieldCoverage,
  resolveSavedFieldIds,
  savedFieldIds,
} from "@/lib/clients/onboarding/ghl-field-coverage";
import { describeGhlDeliveryPreview } from "@/lib/clients/onboarding/ghl-delivery-preview";
import type { SelectableLead } from "@/lib/clients/onboarding/view";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "@/lib/ghl-live-canary/types";
import type { GhlDiscoveredCustomField, RoutingRuleGhlConfigSaveBody } from "@/lib/ghl-config/types";

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
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateConfirm, setActivateConfirm] = useState("");
  const [omittedCore, setOmittedCore] = useState<string[]>([]);
  const [omittedOptional, setOmittedOptional] = useState<string[]>([]);
  const [discoveredFields, setDiscoveredFields] = useState<GhlDiscoveredCustomField[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(() =>
    savedFieldIds(location?.sourceAttributeFieldMapJson)
  );
  const [leadAttributes, setLeadAttributes] = useState<Record<string, string | null> | null>(null);

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
  const activationBlockersOnly =
    (preflight?.blockers.length ?? 0) > 0 &&
    (preflight?.blockers ?? []).every((blocker) =>
      /delivery enabled|deliveryEnabled|delivery mode|cutover|internal approval/i.test(blocker)
    );
  const pausedDestinationTest =
    Boolean(preview?.planId) &&
    !duplicateBlocked &&
    !uncertain &&
    (preflight?.canExecute === true || activationBlockersOnly);
  const canExecute = pausedDestinationTest && confirmText.trim() === LIVE_CANARY_CONFIRMATION_TEXT;
  const canActivate = activateConfirm.trim() === "ENABLE ONGOING GHL DELIVERY";
  const coverage = useMemo(
    () =>
      leadAttributes
        ? classifyGhlFieldCoverage({
            sourceAttributes: leadAttributes,
            mappings: fieldMap,
            discoveredIds: new Set(discoveredFields.map((field) => field.id)),
          })
        : null,
    [discoveredFields, fieldMap, leadAttributes]
  );

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
    const fields = result.discovery.customFields;
    setDiscoveredFields(fields);
    setFieldMap((current) => resolveSavedFieldIds(current, fields));
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

  async function saveFieldMap() {
    if (!selectedLocationId) return;
    setPending("fields");
    setError(null);
    const sourceAttributeFieldMapJson: Record<string, { ghlFieldKey: string; requirement: "optional" }> = {};
    for (const [canonical, fieldId] of Object.entries(fieldMap)) {
      if (fieldId.trim()) sourceAttributeFieldMapJson[canonical] = { ghlFieldKey: fieldId.trim(), requirement: "optional" };
    }
    const result = await actions.saveFieldMap({ locationId: selectedLocationId, sourceAttributeFieldMapJson });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.deliveryEnabled !== null) setDeliveryEnabled(result.deliveryEnabled);
  }

  async function reviewLeadFields() {
    if (!eventId) return;
    setPending("attributes");
    setError(null);
    const result = await actions.loadLeadAttributes(eventId);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLeadAttributes(result.sourceAttributes);
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

  async function activateOngoing() {
    if (!canActivate) return;
    setPending("activate");
    setError(null);
    const result = await actions.activateOngoing(crypto.randomUUID(), activateConfirm.trim());
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDeliveryEnabled(true);
    setOmittedCore(result.omittedCoreFields);
    setOmittedOptional(result.omittedOptionalFields);
    setActivateOpen(false);
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
        <li>Map canonical answers to discovered GHL field ids. A blank source value stays separate from a missing mapping.</li>
        <li>Preview GHL delivery for the same stored lead, then run one GHL test. The test does not enable ongoing delivery.</li>
        <li>Enable ongoing GHL delivery after the test. Later incoming events deliver on their own.</li>
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
      <div className="space-y-3 border-t border-slate-200 pt-4" data-testid="ghl-field-map">
        <h3 className="text-sm font-semibold text-slate-900">GHL field mapping</h3>
        <p className="text-sm text-slate-600">
          Each row stores the discovered GHL field id. Saving this map does not enable ongoing delivery.
          primary_reason stays its own field. It is not copied into Primary Concern.
        </p>
        {discoveredFields.length === 0 ? (
          <p className="text-sm text-slate-600">Discover workflows to choose field ids from this location.</p>
        ) : (
          <div className="space-y-2">
            {CANONICAL_SURVEY_ATTRIBUTES.map((canonical) => (
              <Label key={canonical} className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
                <span className="font-mono text-xs">{canonical}</span>
                <select
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                  aria-label={`GHL field for ${canonical}`}
                  value={discoveredFields.some((field) => field.id === fieldMap[canonical]) ? fieldMap[canonical] : ""}
                  onChange={(event) =>
                    setFieldMap((current) => ({ ...current, [canonical]: event.target.value }))
                  }
                >
                  <option value="">Unmapped</option>
                  {discoveredFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name} · {field.id}
                    </option>
                  ))}
                </select>
              </Label>
            ))}
            <Button type="button" variant="outline" disabled={pending !== null || !selectedLocationId} onClick={() => void saveFieldMap()}>
              {pending === "fields" ? "Saving field ids…" : "Save field ids"}
            </Button>
          </div>
        )}
        <Button type="button" variant="outline" disabled={pending !== null || !eventId} onClick={() => void reviewLeadFields()}>
          {pending === "attributes" ? "Reading lead values…" : "Review this lead's field values"}
        </Button>
        {coverage ? (
          <div className="space-y-1 text-sm" data-testid="ghl-field-coverage">
            <p>
              Mapped:{" "}
              {coverage.mapped.length
                ? coverage.mapped.map((row) => `${row.key} → ${row.fieldId}`).join(", ")
                : "none"}
              .
            </p>
            <p>
              Missing mappings:{" "}
              {coverage.missingMappings.length
                ? coverage.missingMappings.map((row) => `${row.key} (${row.sourceValue})`).join(", ")
                : "none"}
              .
            </p>
            <p>
              Missing source values:{" "}
              {coverage.missingSourceValues.length
                ? coverage.missingSourceValues.map((row) => `${row.key} → ${row.fieldId}`).join(", ")
                : "none"}
              .
            </p>
            <p>Missing source values are mapped and blank. Missing mappings are not sent.</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">GHL test for this stored lead</h3>
        <p className="text-sm text-slate-600">
          Preview uses the delivery-plan simulation. It is stored and sends nothing. Run one GHL test sends the selected
          lead to the saved location and does not turn ongoing delivery on.
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
            {fieldMapping ? (
              <div data-testid="ghl-omitted-fields">
                <p>
                  Omitted core fields: {fieldMapping.coreRequiredMissing.length ? fieldMapping.coreRequiredMissing.join(", ") : "none"}.
                </p>
                <p>
                  Omitted optional fields: {fieldMapping.optionalMissing.length ? fieldMapping.optionalMissing.join(", ") : "none"}.
                </p>
                <p>Omitted fields are not sent.</p>
              </div>
            ) : null}
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
          disabled={!pausedDestinationTest || pending !== null}
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
            {execution.outcome === "held" || execution.skippedDuplicate ? (
              <p>This event already has a GHL delivery record. It was not sent again.</p>
            ) : null}
            <p>Contact id: {execution.contactIdGhl ?? "none"}.</p>
            <p>Workflow started: {execution.workflowStarted ? "yes" : "no"}.</p>
            <p>Opportunity id: {execution.opportunityIdGhl ?? "none"}.</p>
            <p>Ongoing delivery changed: no.</p>
            {execution.errors.length > 0 ? <p>{execution.errors.join(" ")}</p> : null}
          </div>
        ) : null}
        <div className="space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Enable ongoing GHL delivery</h3>
          <p className="text-sm text-slate-600">
            This turns on delivery for the saved location on this client. Sheets delivery stays on its own switch.
            This does not edit an environment list.
          </p>
          {omittedCore.length > 0 || omittedOptional.length > 0 ? (
            <div data-testid="ghl-activation-omissions">
              <p>Omitted core fields: {omittedCore.length ? omittedCore.join(", ") : "none"}.</p>
              <p>Omitted optional fields: {omittedOptional.length ? omittedOptional.join(", ") : "none"}.</p>
              <p>Omitted fields are not sent.</p>
            </div>
          ) : null}
          <Button type="button" disabled={pending !== null} onClick={() => setActivateOpen(true)}>
            Enable ongoing GHL delivery
          </Button>
          {activateOpen ? (
            <div className="space-y-2 rounded-lg border border-slate-300 p-3">
              <p className="text-sm">
                Type <span className="font-mono font-semibold">ENABLE ONGOING GHL DELIVERY</span> to activate this saved
                location.
              </p>
              <Input
                aria-label="Ongoing GHL confirmation"
                value={activateConfirm}
                onChange={(event) => setActivateConfirm(event.target.value)}
                autoComplete="off"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setActivateOpen(false)}>
                  Cancel activation
                </Button>
                <Button type="button" disabled={!canActivate || pending !== null} onClick={() => void activateOngoing()}>
                  {pending === "activate" ? "Enabling ongoing GHL delivery…" : "Confirm ongoing GHL delivery"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-amber-900" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
