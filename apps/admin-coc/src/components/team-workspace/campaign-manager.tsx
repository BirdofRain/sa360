"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createClientCampaignAction,
  readClientCampaignAction,
  saveClientCampaignBindingsAction,
  saveClientCampaignDestinationAction,
  updateClientCampaignAction,
} from "@/app/actions/client-campaign-manager";
import { CLIENT_NICHE_OPTIONS, CLIENT_PRODUCT_OPTIONS } from "@/lib/clients/client-profile-options";
import {
  CAMPAIGN_CONFIG_STATUSES,
  CAMPAIGN_PROVIDERS,
  CAMPAIGN_TRIGGER_MODES,
  bindingDraftFromView,
  conflictLabel,
  nicheLabel,
  productLabel,
  warningLabel,
  type BindingDraftInput,
  type CampaignBindingView,
  type CampaignCommandResult,
  type CampaignDestinationView,
  type CampaignDetailView,
  type CampaignSummaryView,
  type ClientCampaignManagerModel,
} from "@/lib/team-workspace/client-campaign-manager";

const fieldClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-950";

export function CampaignManager({
  clientAccountId,
  model,
  canMutate,
}: {
  clientAccountId: string;
  model: ClientCampaignManagerModel;
  canMutate: boolean;
}) {
  const router = useRouter();
  const slots = useRef<Record<string, { key: string; id: string }>>({});
  const inflight = useRef(false);
  const [campaigns, setCampaigns] = useState<CampaignSummaryView[]>(model.availability === "ready" ? model.campaigns : []);
  const [detail, setDetail] = useState<CampaignDetailView | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<CampaignCommandResult | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(0);

  useEffect(() => {
    if (model.availability !== "ready") return;
    setCampaigns((current) => {
      const serverIds = new Set(model.campaigns.map((campaign) => campaign.id));
      return [...model.campaigns, ...current.filter((campaign) => !serverIds.has(campaign.id))];
    });
  }, [model]);

  function idFor(slot: string, key: string): string {
    const current = slots.current[slot];
    if (current?.key === key) return current.id;
    const id = crypto.randomUUID();
    slots.current[slot] = { key, id };
    return id;
  }

  function settle(slot: string, result: CampaignCommandResult) {
    if (!result.retainRequestId) delete slots.current[slot];
    setNotice(result);
    setSaving(null);
    inflight.current = false;
    if (!result.stored || !result.campaign) return;
    if (slot === "create") setDraftKey((value) => value + 1);
    const saved = result.campaign;
    setCampaigns((current) => {
      const rest = current.filter((campaign) => campaign.id !== saved.id);
      return [...rest, { ...saved, bindingCount: result.bindings?.length ?? saved.bindingCount, destinationSaved: result.destinationIncluded ? result.destination !== null : saved.destinationSaved }];
    });
    setDetail((current) => ({
      campaign: saved,
      bindings: result.bindings ?? current?.bindings ?? [],
      destination: result.destinationIncluded ? result.destination : (current?.destination ?? null),
    }));
    router.refresh();
  }

  async function run(slot: string, key: string, send: (requestId: string) => Promise<CampaignCommandResult>) {
    if (inflight.current) return;
    inflight.current = true;
    setSaving(slot);
    setNotice(null);
    const requestId = idFor(slot, key);
    try {
      const result = await send(requestId);
      settle(slot, result);
    } catch {
      settle(slot, {
        ok: false,
        uncertain: true,
        stored: false,
        recordedCommand: false,
        retainRequestId: true,
        code: null,
        outcome: null,
        message: "The save did not finish. Retry uses the same request id. Nothing on this page was marked saved.",
        revision: null,
        requestId: null,
        replayed: false,
        conflicts: [],
        campaign: null,
        bindings: null,
        destination: null,
        destinationIncluded: false,
      });
    }
  }

  async function openCampaign(campaignId: string) {
    setOpening(true);
    setOpenError(null);
    setNotice(null);
    try {
      const result = await readClientCampaignAction({ clientAccountId, campaignId });
      if (!result.ok) {
        setOpenError(result.message);
        return;
      }
      setDetail(result.detail);
    } catch {
      setOpenError("This campaign could not be loaded. Nothing was changed.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" data-configuration-only="true">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">Campaigns</h2>
        <p className="max-w-3xl text-sm text-slate-700">
          Saved campaign configuration for this client. This section does not route leads, confirm a source, enroll a contact, or deliver to GoHighLevel or Sheets.
        </p>
      </header>
      {model.availability === "disabled" || model.availability === "error" ? (
        <p className="text-sm text-slate-700" data-campaign-availability={model.availability}>
          {model.message}
        </p>
      ) : (
        <div className="space-y-6">
          <CampaignList campaigns={campaigns} opening={opening} onOpen={(id) => void openCampaign(id)} />
          {openError ? <p className="text-sm text-slate-700">{openError}</p> : null}
          {opening ? <p className="text-sm text-slate-600">Loading this campaign.</p> : null}
          {canMutate ? (
            <CreateDraft
              key={draftKey}
              saving={saving === "create"}
              onSave={(draft) =>
                void run("create", JSON.stringify(draft), (requestId) =>
                  createClientCampaignAction({ clientAccountId, requestId, ...draft })
                )
              }
            />
          ) : (
            <p className="text-sm text-slate-600">This session can read campaign configuration. A team manager saves it.</p>
          )}
          {detail ? (
            <CampaignEditor
              detail={detail}
              canMutate={canMutate}
              saving={saving}
              onSaveProfile={(draft) =>
                void run("profile", JSON.stringify({ id: detail.campaign.id, ...draft }), (requestId) =>
                  updateClientCampaignAction({
                    clientAccountId,
                    campaignId: detail.campaign.id,
                    requestId,
                    ...draft,
                  })
                )
              }
              onSaveBindings={(bindings) =>
                void run(
                  "bindings",
                  JSON.stringify({ id: detail.campaign.id, revision: detail.campaign.revision, bindings }),
                  (requestId) =>
                    saveClientCampaignBindingsAction({
                      clientAccountId,
                      campaignId: detail.campaign.id,
                      requestId,
                      expectedRevision: detail.campaign.revision,
                      bindings,
                    })
                )
              }
              onSaveDestination={(destination) =>
                void run(
                  "destination",
                  JSON.stringify({ id: detail.campaign.id, revision: detail.campaign.revision, ...destination }),
                  (requestId) =>
                    saveClientCampaignDestinationAction({
                      clientAccountId,
                      campaignId: detail.campaign.id,
                      requestId,
                      expectedRevision: detail.campaign.revision,
                      ...destination,
                    })
                )
              }
            />
          ) : null}
          <CommandNotice notice={notice} saving={saving !== null} />
        </div>
      )}
    </section>
  );
}

function CampaignList({
  campaigns,
  opening,
  onOpen,
}: {
  campaigns: CampaignSummaryView[];
  opening: boolean;
  onOpen: (campaignId: string) => void;
}) {
  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-slate-700" data-campaign-availability="empty">
        No saved campaigns. A new draft is configuration only and does not start delivery.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {campaigns.map((campaign) => (
        <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2" data-campaign-id={campaign.id} data-campaign-niche={campaign.nicheKey}>
          <div>
            <p className="text-sm font-medium text-slate-950">{campaign.displayName}</p>
            <p className="text-xs text-slate-600">
              {nicheLabel(campaign.nicheKey)} · {productLabel(campaign.productType)} · {campaign.status} · revision {campaign.revision}
            </p>
            <p className="font-mono text-xs text-slate-500">
              {campaign.slug} · {campaign.id}
            </p>
          </div>
          <button type="button" className="text-sm font-medium text-sky-800 underline disabled:opacity-50" disabled={opening} onClick={() => onOpen(campaign.id)}>
            Open {campaign.slug}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CreateDraft({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: (draft: { slug: string; displayName: string; nicheKey: string; productType: string }) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [nicheKey, setNicheKey] = useState<string>(CLIENT_NICHE_OPTIONS[0]?.value ?? "VET");
  const [productType, setProductType] = useState<string>(CLIENT_PRODUCT_OPTIONS[0]?.value ?? "life_insurance");
  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ slug, displayName, nicheKey, productType });
      }}
    >
      <h3 className="text-sm font-semibold text-slate-950">New campaign draft</h3>
      <p className="text-xs text-slate-600">The slug identifies the draft for this client. The display name and niche do not.</p>
      <label className="block text-xs font-medium text-slate-700">
        Display name
        <input className={fieldClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={saving} />
      </label>
      <label className="block text-xs font-medium text-slate-700">
        Slug
        <input className={fieldClass} value={slug} onChange={(event) => setSlug(event.target.value)} disabled={saving} spellCheck={false} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Niche" value={nicheKey} onChange={setNicheKey} disabled={saving} options={CLIENT_NICHE_OPTIONS} />
        <Select label="Product" value={productType} onChange={setProductType} disabled={saving} options={CLIENT_PRODUCT_OPTIONS} />
      </div>
      <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={saving}>
        {saving ? "Saving this configuration" : "Save campaign draft"}
      </button>
    </form>
  );
}

function CampaignEditor({
  detail,
  canMutate,
  saving,
  onSaveProfile,
  onSaveBindings,
  onSaveDestination,
}: {
  detail: CampaignDetailView;
  canMutate: boolean;
  saving: string | null;
  onSaveProfile: (draft: {
    expectedRevision: number;
    displayName: string;
    nicheKey: string;
    productType: string;
    status: string;
  }) => void;
  onSaveBindings: (bindings: BindingDraftInput[]) => void;
  onSaveDestination: (destination: {
    workflowIdGhl: string | null;
    workflowTriggerMode: string | null;
    ghlLocationId: string | null;
    spreadsheetId: string | null;
    worksheetId: number | null;
    worksheetTitle: string | null;
  }) => void;
}) {
  const campaign = detail.campaign;
  const [displayName, setDisplayName] = useState(campaign.displayName);
  const [nicheKey, setNicheKey] = useState(campaign.nicheKey);
  const [productType, setProductType] = useState(campaign.productType);
  const [status, setStatus] = useState(CAMPAIGN_CONFIG_STATUSES.includes(campaign.status as (typeof CAMPAIGN_CONFIG_STATUSES)[number]) ? campaign.status : "draft");
  const [bindings, setBindings] = useState<BindingDraftInput[]>(detail.bindings.map(bindingDraftFromView));
  const [workflowIdGhl, setWorkflowIdGhl] = useState(detail.destination?.workflowIdGhl ?? "");
  const [workflowTriggerMode, setWorkflowTriggerMode] = useState(detail.destination?.workflowTriggerMode ?? "");
  const [worksheetId, setWorksheetId] = useState(detail.destination?.worksheetId?.toString() ?? "");
  const [worksheetTitle, setWorksheetTitle] = useState(detail.destination?.worksheetTitle ?? "");

  useEffect(() => {
    setDisplayName(campaign.displayName);
    setNicheKey(campaign.nicheKey);
    setProductType(campaign.productType);
    setStatus(CAMPAIGN_CONFIG_STATUSES.includes(campaign.status as (typeof CAMPAIGN_CONFIG_STATUSES)[number]) ? campaign.status : "draft");
    setBindings(detail.bindings.map(bindingDraftFromView));
    setWorkflowIdGhl(detail.destination?.workflowIdGhl ?? "");
    setWorkflowTriggerMode(detail.destination?.workflowTriggerMode ?? "");
    setWorksheetId(detail.destination?.worksheetId?.toString() ?? "");
    setWorksheetTitle(detail.destination?.worksheetTitle ?? "");
  }, [campaign, detail.bindings, detail.destination]);

  const busy = saving !== null;
  return (
    <div className="space-y-5" data-open-campaign={campaign.id}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-950">{campaign.displayName}</h3>
        <p className="font-mono text-xs text-slate-500">
          Saved revision {campaign.revision} · {campaign.id}
        </p>
        <p className="text-xs text-slate-600">Same niche and product can belong to another campaign. This record stays separate.</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveProfile({ expectedRevision: campaign.revision, displayName, nicheKey, productType, status });
        }}
      >
        <label className="block text-xs font-medium text-slate-700">
          Display name
          <input className={fieldClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={!canMutate || busy} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Niche" value={nicheKey} onChange={setNicheKey} disabled={!canMutate || busy} options={CLIENT_NICHE_OPTIONS} />
          <Select label="Product" value={productType} onChange={setProductType} disabled={!canMutate || busy} options={CLIENT_PRODUCT_OPTIONS} />
          <Select
            label="Configuration status"
            value={status}
            onChange={setStatus}
            disabled={!canMutate || busy}
            options={CAMPAIGN_CONFIG_STATUSES.map((value) => ({ value, label: value }))}
          />
        </div>
        {canMutate ? (
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>
            {saving === "profile" ? "Saving this configuration" : "Save campaign details"}
          </button>
        ) : null}
      </form>
      <BindingEditor
        bindings={bindings}
        saved={detail.bindings}
        canMutate={canMutate}
        saving={saving === "bindings"}
        disabled={busy}
        onChange={setBindings}
        onSave={() => onSaveBindings(bindings)}
      />
      <DestinationEditor
        destination={detail.destination}
        workflowIdGhl={workflowIdGhl}
        workflowTriggerMode={workflowTriggerMode}
        worksheetId={worksheetId}
        worksheetTitle={worksheetTitle}
        canMutate={canMutate}
        saving={saving === "destination"}
        disabled={busy}
        onWorkflowId={setWorkflowIdGhl}
        onTrigger={setWorkflowTriggerMode}
        onWorksheetId={setWorksheetId}
        onWorksheetTitle={setWorksheetTitle}
        onSave={() =>
          onSaveDestination({
            workflowIdGhl: workflowIdGhl.trim() ? workflowIdGhl : null,
            workflowTriggerMode: workflowTriggerMode || null,
            ghlLocationId: detail.destination?.ghlLocationId ?? null,
            spreadsheetId: detail.destination?.spreadsheetId ?? null,
            worksheetId: worksheetId.trim() ? Number(worksheetId) : null,
            worksheetTitle: worksheetTitle.trim() ? worksheetTitle : null,
          })
        }
      />
    </div>
  );
}

function BindingEditor({
  bindings,
  saved,
  canMutate,
  saving,
  disabled,
  onChange,
  onSave,
}: {
  bindings: BindingDraftInput[];
  saved: CampaignBindingView[];
  canMutate: boolean;
  saving: boolean;
  disabled: boolean;
  onChange: (bindings: BindingDraftInput[]) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-950">Source requests</h4>
      <p className="text-xs text-slate-600">
        Suggested, recorded, and approved are configuration requests. Approved does not confirm the source. Removing a request from the next save marks the previous one superseded. It does not delete a live source.
      </p>
      {saved.map((binding) => (
        <div key={binding.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p className="font-medium text-slate-950">
            {binding.bindingKey} · {binding.status} · binding revision {binding.revision}
          </p>
          {binding.identities.length === 0 ? <p>No exact identifier is stored on this request.</p> : null}
          {binding.identities.map((identity) => (
            <p key={`${identity.kind}-${identity.normalizedValue}`} className="font-mono">
              {identity.provider} · {identity.kind} · {identity.normalizedValue}
            </p>
          ))}
          <p>Evidence is a note only. It is not a join key. Origin confirmed: no.</p>
          {binding.observedLabel ? <p>Observed label: {binding.observedLabel}</p> : null}
        </div>
      ))}
      {bindings.map((binding, index) => (
        <BindingFields
          key={`${binding.bindingKey}-${index}`}
          binding={binding}
          disabled={!canMutate || disabled}
          onChange={(next) => onChange(bindings.map((item, itemIndex) => (itemIndex === index ? next : item)))}
          onRemove={() => onChange(bindings.filter((_, itemIndex) => itemIndex !== index))}
        />
      ))}
      {canMutate ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 disabled:opacity-50"
            disabled={disabled}
            onClick={() => onChange([...bindings, emptyBinding()])}
          >
            Add source request
          </button>
          <button type="button" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={disabled} onClick={onSave}>
            {saving ? "Saving this configuration" : "Save source requests"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BindingFields({
  binding,
  disabled,
  onChange,
  onRemove,
}: {
  binding: BindingDraftInput;
  disabled: boolean;
  onChange: (binding: BindingDraftInput) => void;
  onRemove: () => void;
}) {
  const suggested = binding.requestedStatus === "suggested";
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3" disabled={disabled}>
      <label className="block text-xs font-medium text-slate-700">
        Request key
        <input className={fieldClass} value={binding.bindingKey} onChange={(event) => onChange({ ...binding, bindingKey: event.target.value })} spellCheck={false} />
      </label>
      <Select
        label="Request status"
        value={binding.requestedStatus}
        onChange={(requestedStatus) =>
          onChange({
            ...binding,
            requestedStatus: requestedStatus as BindingDraftInput["requestedStatus"],
            provider: requestedStatus === "suggested" ? null : binding.provider,
            providerFunnelId: requestedStatus === "suggested" ? null : binding.providerFunnelId,
            parentUrlKey: requestedStatus === "suggested" ? null : binding.parentUrlKey,
            campaignId: requestedStatus === "suggested" ? null : binding.campaignId,
            formId: requestedStatus === "suggested" ? null : binding.formId,
            adsetId: requestedStatus === "suggested" ? null : binding.adsetId,
            adId: requestedStatus === "suggested" ? null : binding.adId,
            campaignRoutingRuleId: requestedStatus === "suggested" ? null : binding.campaignRoutingRuleId,
          })
        }
        disabled={disabled}
        options={[
          { value: "suggested", label: "Suggested" },
          { value: "recorded", label: "Recorded" },
          { value: "approved", label: "Approved identifier" },
        ]}
      />
      <Select
        label="Provider"
        value={binding.provider ?? ""}
        onChange={(provider) => onChange({ ...binding, provider: (provider || null) as BindingDraftInput["provider"] })}
        disabled={disabled || suggested}
        options={[{ value: "", label: "None" }, ...CAMPAIGN_PROVIDERS.map((value) => ({ value, label: value }))]}
      />
      <label className="block text-xs font-medium text-slate-700">
        Source funnel id
        <input className={fieldClass} value={binding.sourceFunnelId ?? ""} onChange={(event) => onChange({ ...binding, sourceFunnelId: event.target.value || null })} spellCheck={false} />
      </label>
      <ExactField label="Provider funnel id" value={binding.providerFunnelId} disabled={disabled || suggested} onChange={(providerFunnelId) => onChange({ ...binding, providerFunnelId })} />
      <ExactField label="Parent URL key" value={binding.parentUrlKey} disabled={disabled || suggested} onChange={(parentUrlKey) => onChange({ ...binding, parentUrlKey })} />
      <ExactField label="Source campaign id" value={binding.campaignId} disabled={disabled || suggested} onChange={(campaignId) => onChange({ ...binding, campaignId })} />
      <ExactField label="Form id" value={binding.formId} disabled={disabled || suggested} onChange={(formId) => onChange({ ...binding, formId })} />
      <ExactField label="Ad set id" value={binding.adsetId} disabled={disabled || suggested} onChange={(adsetId) => onChange({ ...binding, adsetId })} />
      <ExactField label="Ad id" value={binding.adId} disabled={disabled || suggested} onChange={(adId) => onChange({ ...binding, adId })} />
      <label className="block text-xs font-medium text-slate-700">
        Routing rule id
        <input
          className={fieldClass}
          value={binding.campaignRoutingRuleId ?? ""}
          disabled={suggested}
          onChange={(event) => onChange({ ...binding, campaignRoutingRuleId: event.target.value || null })}
          spellCheck={false}
        />
      </label>
      <label className="block text-xs font-medium text-slate-700">
        Evidence note
        <input className={fieldClass} value={binding.evidence?.note ?? ""} onChange={(event) => onChange({ ...binding, evidence: { note: event.target.value || null, observedLabel: binding.evidence?.observedLabel ?? null } })} />
      </label>
      <label className="block text-xs font-medium text-slate-700">
        Observed label
        <input className={fieldClass} value={binding.evidence?.observedLabel ?? ""} onChange={(event) => onChange({ ...binding, evidence: { note: binding.evidence?.note ?? null, observedLabel: event.target.value || null } })} />
      </label>
      <p className="text-xs text-slate-500">The note and observed label are not join keys.</p>
      <button type="button" className="text-sm text-slate-700 underline" onClick={onRemove}>
        Remove from next save
      </button>
    </fieldset>
  );
}

function DestinationEditor({
  destination,
  workflowIdGhl,
  workflowTriggerMode,
  worksheetId,
  worksheetTitle,
  canMutate,
  saving,
  disabled,
  onWorkflowId,
  onTrigger,
  onWorksheetId,
  onWorksheetTitle,
  onSave,
}: {
  destination: CampaignDestinationView | null;
  workflowIdGhl: string;
  workflowTriggerMode: string;
  worksheetId: string;
  worksheetTitle: string;
  canMutate: boolean;
  saving: boolean;
  disabled: boolean;
  onWorkflowId: (value: string) => void;
  onTrigger: (value: string) => void;
  onWorksheetId: (value: string) => void;
  onWorksheetTitle: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h4 className="text-sm font-semibold text-slate-950">Intended destination</h4>
      <p className="text-xs text-slate-600">
        Choose a workflow and worksheet inside this client&apos;s existing destinations. This does not create a location, publish a map, or change the client default workflow.
      </p>
      <p className="text-xs text-slate-600">
        Existing location: {destination?.ghlLocationId ?? "none saved"} · Existing spreadsheet: {destination?.spreadsheetId ?? "none saved"}
      </p>
      <label className="block text-xs font-medium text-slate-700">
        GHL workflow id
        <input className={fieldClass} value={workflowIdGhl} onChange={(event) => onWorkflowId(event.target.value)} disabled={!canMutate || disabled} spellCheck={false} />
      </label>
      <Select
        label="Trigger mode"
        value={workflowTriggerMode}
        onChange={onTrigger}
        disabled={!canMutate || disabled}
        options={[{ value: "", label: "Not selected" }, ...CAMPAIGN_TRIGGER_MODES.map((value) => ({ value, label: value }))]}
      />
      <label className="block text-xs font-medium text-slate-700">
        Worksheet id
        <input className={fieldClass} value={worksheetId} onChange={(event) => onWorksheetId(event.target.value)} disabled={!canMutate || disabled} inputMode="numeric" />
      </label>
      <label className="block text-xs font-medium text-slate-700">
        Worksheet title
        <input className={fieldClass} value={worksheetTitle} onChange={(event) => onWorksheetTitle(event.target.value)} disabled={!canMutate || disabled} />
      </label>
      {destination ? (
        <ul className="space-y-1 text-xs text-slate-700">
          {destination.readinessWarnings.map((warning) => (
            <li key={warning}>{warningLabel(warning)}</li>
          ))}
          <li>Workflow live verified: no. Map published: no.</li>
        </ul>
      ) : (
        <p className="text-xs text-slate-600">No destination request is saved.</p>
      )}
      {canMutate ? (
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={disabled}>
          {saving ? "Saving this configuration" : "Save destination request"}
        </button>
      ) : null}
    </form>
  );
}

function CommandNotice({ notice, saving }: { notice: CampaignCommandResult | null; saving: boolean }) {
  if (saving) {
    return (
      <p className="text-sm text-slate-700" data-request-state="saving">
        Saving this configuration. It is not live yet.
      </p>
    );
  }
  if (!notice) return null;
  const state = notice.stored ? "saved" : notice.recordedCommand ? "review" : notice.uncertain ? "uncertain" : "error";
  return (
    <div className="space-y-1 text-sm text-slate-800" data-request-state={state}>
      <p>{notice.message}</p>
      {notice.revision !== null ? <p>Revision on this result: {notice.revision}</p> : null}
      {notice.conflicts.map((conflict) => (
        <p key={`${conflict.code}-${conflict.bindingKey}-${conflict.identifierKind}`}>{conflictLabel(conflict)}</p>
      ))}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <select className={fieldClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExactField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <input className={fieldClass} value={value ?? ""} disabled={disabled} spellCheck={false} onChange={(event) => onChange(event.target.value || null)} />
    </label>
  );
}

function emptyBinding(): BindingDraftInput {
  return {
    bindingKey: "",
    requestedStatus: "suggested",
    sourceFunnelId: null,
    campaignRoutingRuleId: null,
    provider: null,
    providerFunnelId: null,
    parentUrlKey: null,
    campaignId: null,
    formId: null,
    adsetId: null,
    adId: null,
    evidence: null,
  };
}
