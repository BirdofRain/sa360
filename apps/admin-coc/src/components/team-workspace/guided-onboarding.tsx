"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  createGuidedClientAction,
  saveGuidedSetupAction,
  updateGuidedClientAction,
  type GuidedClientMutationResult,
  type GuidedSetupSaveResult,
} from "@/app/actions/team-workspace-onboarding";
import { GhlDestinationGuide } from "@/components/team-workspace/ghl-destination-guide";
import { SourceCampaignRequestPanel } from "@/components/team-workspace/source-campaign-request-panel";
import { SourceCampaignReviewPanel } from "@/components/team-workspace/source-campaign-review-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  accountIdAfterDisplayNameChange,
  manuallyEditedAccountId,
  resetToSuggestedAccountId,
  suggestClientAccountId,
  validateClientAccountId,
} from "@/lib/clients/client-account-id-suggestion";
import { CLIENT_NICHE_OPTIONS, CLIENT_PRODUCT_OPTIONS } from "@/lib/clients/client-profile-options";
import { clientSetupSaveAttempt, type ClientSetupSaveAttempt } from "@/lib/clients/client-setup-save-attempt";
import {
  GUIDE_STEP_EXPLANATIONS,
  applyListedCampaign,
  applyListedSource,
  draftFromModel,
  guideBlockers,
  guideFacts,
  guideProgress,
  guideSaveRecovery,
  guideSyncToken,
  setupDataFromDraft,
  validateDraft,
  validateNewClient,
  type GuideFactState,
  type GuideFieldError,
  type GuideSaveRecovery,
  type GuideStepId,
  type GuidedOnboardingModel,
  type GuidedSetupDraft,
} from "@/lib/team-workspace/onboarding-guide";

const selectClass = "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900";
const inputClass = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-900";

const STATE_CLASS: Record<GuideFactState, string> = {
  saved: "border-sky-200 bg-sky-50 text-sky-950",
  configured: "border-indigo-200 bg-indigo-50 text-indigo-950",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-950",
  active: "border-rose-200 bg-rose-50 text-rose-950",
  pending: "border-slate-200 bg-slate-50 text-slate-700",
  unavailable: "border-slate-200 bg-slate-100 text-slate-600",
  blocked: "border-amber-200 bg-amber-50 text-amber-950",
};

const actions = {
  createClient: createGuidedClientAction,
  updateClient: updateGuidedClientAction,
  saveSetup: saveGuidedSetupAction,
};

export function GuidedOnboarding({
  model,
  step,
  clients,
  notice = null,
}: {
  model: GuidedOnboardingModel | null;
  step: GuideStepId;
  clients: { clientAccountId: string; clientDisplayName: string }[];
  notice?: "created" | null;
}) {
  const router = useRouter();
  const token = guideSyncToken(model);
  const [current, setCurrent] = useState<GuideStepId>(model ? step : "client");
  const [draft, setDraft] = useState<GuidedSetupDraft>(() => draftFromModel(model));
  const [revision, setRevision] = useState(model?.setup?.revision ?? 0);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "replayed" | "error">(notice === "created" ? "saved" : "idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(
    notice === "created" ? "Client saved. Delivery is not on. Continue with client information." : null
  );
  const [failure, setFailure] = useState<GuideSaveRecovery | null>(null);
  const [fieldErrors, setFieldErrors] = useState<GuideFieldError[]>([]);
  const [clientAccountId, setClientAccountId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const attempt = useRef<ClientSetupSaveAttempt | null>(null);
  const inflight = useRef(false);
  const progress = guideProgress(model);
  const busy = phase === "saving";

  useEffect(() => {
    setCurrent(model ? step : "client");
  }, [model, step]);

  useEffect(() => {
    if (notice !== "created" || !model) return;
    window.history.replaceState(null, "", `/team-workspace/${model.clientAccountId}?guide=${step}`);
  }, [notice, model, step]);

  useEffect(() => {
    setDraft(draftFromModel(model));
    setRevision(model?.setup?.revision ?? 0);
  }, [token, model]);

  function updateDraft(patch: Partial<GuidedSetupDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }));
    setFieldErrors([]);
    setFailure(null);
    if (phase === "saved" || phase === "replayed" || phase === "error") setPhase("idle");
  }

  function go(next: GuideStepId) {
    if (!model) return;
    const errors = current === "information" || current === "sources" || current === "destination" ? validateDraft(draft, current === "information" ? "account" : "setup") : [];
    if (errors.length > 0 && progress.steps.findIndex((item) => item.id === next) > progress.steps.findIndex((item) => item.id === current)) {
      setFieldErrors(errors);
      return;
    }
    setCurrent(next);
    setFieldErrors([]);
    window.history.replaceState(null, "", `/team-workspace/${model.clientAccountId}?guide=${next}`);
  }

  function claim(): boolean {
    if (inflight.current) return false;
    inflight.current = true;
    return true;
  }

  function unexpectedFailure(kind: "create" | "update" | "setup"): GuideSaveRecovery {
    if (kind === "create") {
      return {
        message: "Creating the client did not finish. Try the same client id again, or reload the list if that client is already there. Delivery was not turned on.",
        action: "retry",
      };
    }
    if (kind === "update") {
      return {
        message: "Saving client information did not finish. Try again. Delivery was not turned on.",
        action: "retry",
      };
    }
    return {
      message: "The setup save did not finish. Try this save again. Delivery was not turned on.",
      action: "retry",
    };
  }

  async function saveSetupInner(success: string): Promise<boolean> {
    if (!model || !model.setupWritable) {
      setFailure({
        message: model?.setupUnavailableReason ?? "Saving a setup request is unavailable.",
        action: model?.setupStale ? "reload" : "none",
      });
      setPhase("error");
      return false;
    }
    const errors = validateDraft(draft, "setup");
    if (errors.length > 0) {
      setFieldErrors(errors);
      setPhase("error");
      return false;
    }
    const data = setupDataFromDraft(draft, model.setup?.data ?? null);
    const nextAttempt = clientSetupSaveAttempt(attempt.current, "save_draft", data, revision);
    attempt.current = nextAttempt;
    setPhase("saving");
    setStatusMessage("Saving the setup request. Delivery stays off.");
    try {
      const result = await actions.saveSetup({
        clientAccountId: model.clientAccountId,
        data,
        requestId: nextAttempt.requestId,
        expectedRevision: revision,
      });
      return applySetupResult(result, success);
    } catch {
      setFailure(unexpectedFailure("setup"));
      setPhase("error");
      setStatusMessage(null);
      return false;
    }
  }

  async function saveSetup(success: string): Promise<boolean> {
    if (!claim()) return false;
    try {
      return await saveSetupInner(success);
    } finally {
      inflight.current = false;
    }
  }

  function applySetupResult(result: GuidedSetupSaveResult, success: string): boolean {
    if (!result.ok) {
      attempt.current = result.code === "REQUEST_ID_CONFLICT" ? null : attempt.current;
      setFailure(guideSaveRecovery(result.code, result.error));
      setPhase("error");
      setStatusMessage(null);
      return false;
    }
    attempt.current = null;
    setRevision(result.revision);
    setFailure(null);
    setFieldErrors([]);
    setPhase(result.replayed ? "replayed" : "saved");
    setStatusMessage(
      result.replayed
        ? "That save was already accepted. Reload if you need to confirm the latest request. Delivery was not turned on."
        : success
    );
    router.refresh();
    return true;
  }

  async function saveInformation() {
    if (!model || !claim()) return;
    try {
      const errors = validateDraft(draft, "account");
      if (errors.length > 0) {
        setFieldErrors(errors);
        return;
      }
      setPhase("saving");
      setStatusMessage("Saving client information. Delivery stays off.");
      let account: GuidedClientMutationResult;
      try {
        account = await actions.updateClient({
          clientAccountId: model.clientAccountId,
          clientDisplayName: draft.clientDisplayName.trim(),
          status: draft.accountStatus,
          primaryNicheKeys: draft.primaryNicheKeys,
          primaryProductTypes: draft.primaryProductTypes,
        });
      } catch {
        setFailure(unexpectedFailure("update"));
        setPhase("error");
        setStatusMessage(null);
        return;
      }
      if (!account.ok) {
        setFailure(guideSaveRecovery(account.code, account.error));
        setPhase("error");
        setStatusMessage(null);
        return;
      }
      if (!model.setupWritable) {
        setPhase("saved");
        setStatusMessage("Client information was saved. The setup request was not changed, and delivery was not turned on.");
        router.refresh();
        return;
      }
      const saved = await saveSetupInner("Client information and the setup request were saved. Delivery was not turned on.");
      if (!saved) {
        setStatusMessage("The client account was saved. The setup request was not. Delivery was not turned on.");
      }
    } finally {
      inflight.current = false;
    }
  }

  function saveCurrent() {
    if (!model || current === "client") {
      void createClient();
      return;
    }
    if (current === "information" || current === "summary") {
      void saveInformation();
      return;
    }
    void saveSetup("The setup request was saved. Delivery was not turned on.");
  }

  async function createClient() {
    if (!claim()) return;
    try {
      const errors = validateNewClient({ clientAccountId, clientDisplayName: draft.clientDisplayName });
      if (errors.length > 0) {
        setFieldErrors(errors);
        return;
      }
      setPhase("saving");
      setStatusMessage("Creating the client. Delivery stays off.");
      let result: GuidedClientMutationResult;
      try {
        result = await actions.createClient({
          clientAccountId: clientAccountId.trim(),
          clientDisplayName: draft.clientDisplayName.trim(),
          primaryNicheKeys: draft.primaryNicheKeys,
          primaryProductTypes: draft.primaryProductTypes,
        });
      } catch {
        setFailure(unexpectedFailure("create"));
        setPhase("error");
        setStatusMessage(null);
        return;
      }
      if (!result.ok) {
        setFailure(guideSaveRecovery(result.code, result.error));
        setPhase("error");
        setStatusMessage(null);
        return;
      }
      setFailure(null);
      setPhase("saved");
      setStatusMessage("Client saved. Delivery is not on. Continue with client information.");
      router.push(`/team-workspace/${result.clientAccountId}?guide=information&created=1`);
    } finally {
      inflight.current = false;
    }
  }

  function reload() {
    setStatusMessage("Reloading the saved request.");
    router.refresh();
  }

  const errorFor = (field: string) => fieldErrors.find((error) => error.field === field)?.message;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="guided-setup-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="guided-setup-title" className="text-lg font-semibold text-slate-950">
            Guided client setup
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            {GUIDE_STEP_EXPLANATIONS[model ? current : "client"]} Saved, configured, verified, and active are different. This setup only saves a request.
          </p>
        </div>
        <p className="text-sm font-medium text-slate-700" data-progress={progress.savedCount}>
          {progress.savedCount} of 5 steps saved
        </p>
      </div>
      <ol className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-5" aria-label="Guided setup steps">
        {progress.steps.map((item, index) => {
          const selected = model ? current === item.id : item.id === "client";
          return (
            <li key={item.id} className="min-w-[9.5rem] lg:min-w-0">
              <button
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"}`}
                aria-current={selected ? "step" : undefined}
                disabled={!model && item.id !== "client"}
                onClick={() => go(item.id)}
              >
                <span className="block text-xs opacity-80">{index + 1}</span>
                <span className="font-medium">{item.title}</span>
                <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${selected ? "border-white/30 text-white" : STATE_CLASS[item.state]}`}>
                  {labelFor(item.state)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4" aria-busy={busy} data-guide-step={model ? current : "client"}>
        {statusMessage ? (
          <p role="status" className="mb-3 text-sm text-slate-700">
            {statusMessage}
          </p>
        ) : null}
        {fieldErrors.length > 0 ? (
          <ul role="alert" className="mb-3 list-disc space-y-1 pl-5 text-sm text-red-700">
            {fieldErrors.map((error) => (
              <li key={error.field}>{error.message}</li>
            ))}
          </ul>
        ) : null}
        {failure ? (
          <div role="alert" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>{failure.message}</p>
            {failure.action === "reload" ? (
              <Button className="mt-2" type="button" variant="outline" onClick={reload}>
                Reload saved setup
              </Button>
            ) : null}
            {failure.action === "retry" ? (
              <Button className="mt-2" type="button" variant="outline" disabled={busy} onClick={() => void saveCurrent()}>
                Try this save again
              </Button>
            ) : null}
            {failure.action === "new_request" ? (
              <Button
                className="mt-2"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  attempt.current = null;
                  void saveCurrent();
                }}
              >
                Start a new save
              </Button>
            ) : null}
          </div>
        ) : null}
        {!model || current === "client" ? (
          <ClientStep
            model={model}
            clients={clients}
            draft={draft}
            clientAccountId={clientAccountId}
            idEdited={idEdited}
            busy={busy}
            errorFor={errorFor}
            onName={(value) => {
              updateDraft({ clientDisplayName: value });
              if (!idEdited) setClientAccountId(accountIdAfterDisplayNameChange({ value: clientAccountId, manuallyEdited: false }, value).value);
            }}
            onId={(value) => {
              const next = manuallyEditedAccountId(value);
              setIdEdited(next.manuallyEdited);
              setClientAccountId(next.value);
            }}
            onUseSuggested={() => {
              const next = resetToSuggestedAccountId(draft.clientDisplayName);
              setIdEdited(next.manuallyEdited);
              setClientAccountId(next.value);
            }}
            onNiches={(primaryNicheKeys) => updateDraft({ primaryNicheKeys })}
            onProducts={(primaryProductTypes) => updateDraft({ primaryProductTypes })}
            onCreate={() => void createClient()}
          />
        ) : null}
        {model && current === "information" ? (
          <InformationStep
            model={model}
            draft={draft}
            busy={busy}
            errorFor={errorFor}
            onDraft={updateDraft}
            onSave={() => void saveInformation()}
          />
        ) : null}
        {model && current === "sources" ? (
          <SourcesStep
            model={model}
            draft={draft}
            busy={busy}
            errorFor={errorFor}
            onDraft={updateDraft}
            onSave={() => void saveSetup("The source and campaign request was saved. No routing rule was changed, and delivery was not turned on.")}
          />
        ) : null}
        {model && current === "destination" ? (
          <DestinationStep model={model} draft={draft} busy={busy} onDraft={updateDraft} onSave={() => void saveSetup("The destination choice was saved. GoHighLevel and Company Sheets were not changed, and delivery was not turned on.")} />
        ) : null}
        {model && current === "summary" ? <SummaryStep model={model} busy={busy} onSave={() => void saveInformation()} /> : null}
      </div>
      {model ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" disabled={busy || current === "client"} onClick={() => go(previousStep(current))}>
            Back
          </Button>
          <Button type="button" variant="outline" disabled={busy || current === "summary"} onClick={() => go(nextStep(current))}>
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function previousStep(step: GuideStepId): GuideStepId {
  const index = ["client", "information", "sources", "destination", "summary"].indexOf(step);
  return (["client", "information", "sources", "destination", "summary"] as GuideStepId[])[Math.max(0, index - 1)] ?? "client";
}

function nextStep(step: GuideStepId): GuideStepId {
  const order = ["client", "information", "sources", "destination", "summary"] as GuideStepId[];
  const index = order.indexOf(step);
  return order[Math.min(order.length - 1, index + 1)] ?? "summary";
}

function labelFor(state: GuideFactState): string {
  if (state === "saved") return "Saved";
  if (state === "configured") return "Configured";
  if (state === "verified") return "Verified";
  if (state === "active") return "Active";
  if (state === "blocked") return "Blocked";
  if (state === "unavailable") return "Unavailable";
  return "Pending";
}

function ChoiceToggles({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-sm font-medium text-slate-800">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={`rounded-full border px-3 py-1 text-sm ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"}`}
              onClick={() => onChange(selected ? value.filter((item) => item !== option.value) : [...value, option.value])}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-700">{message}</p>;
}

function ClientStep({
  model,
  clients,
  draft,
  clientAccountId,
  idEdited,
  busy,
  errorFor,
  onName,
  onId,
  onUseSuggested,
  onNiches,
  onProducts,
  onCreate,
}: {
  model: GuidedOnboardingModel | null;
  clients: { clientAccountId: string; clientDisplayName: string }[];
  draft: GuidedSetupDraft;
  clientAccountId: string;
  idEdited: boolean;
  busy: boolean;
  errorFor: (field: string) => string | undefined;
  onName: (value: string) => void;
  onId: (value: string) => void;
  onUseSuggested: () => void;
  onNiches: (value: string[]) => void;
  onProducts: (value: string[]) => void;
  onCreate: () => void;
}) {
  if (model?.account) {
    return (
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          <span className="font-medium text-slate-950">{model.account.clientDisplayName}</span> is the selected client. Account status is {model.account.status}. That is not lead delivery.
        </p>
        <p>
          <Link className="font-medium text-sky-800 underline" href="/team-workspace">
            Choose a different client
          </Link>
        </p>
      </div>
    );
  }
  const idCheck = validateClientAccountId(clientAccountId);
  const suggestion = suggestClientAccountId(draft.clientDisplayName);
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onCreate();
      }}
    >
      <p className="text-sm text-slate-600">
        {clients.length > 0
          ? "Pick a client from the list, or create one here. A new client starts in onboarding and does not turn on delivery."
          : "Create the first client. It starts in onboarding and does not turn on delivery."}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="guide-client-name">Client name</Label>
        <input id="guide-client-name" className={inputClass} value={draft.clientDisplayName} onChange={(event) => onName(event.target.value)} disabled={busy} required />
        <FieldError message={errorFor("clientDisplayName")} />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="guide-client-id">Client id</Label>
          {idEdited ? (
            <button type="button" className="text-xs text-sky-800 underline" onClick={onUseSuggested}>
              Use suggested id
            </button>
          ) : null}
        </div>
        <input id="guide-client-id" value={clientAccountId} onChange={(event) => onId(event.target.value)} disabled={busy} className={`${inputClass} font-mono`} required />
        <p className={`text-xs ${idCheck.valid ? "text-slate-500" : "text-red-700"}`}>
          {errorFor("clientAccountId") ?? (idCheck.valid ? "Lowercase letters, numbers, and underscores." : idCheck.message ?? suggestion.message)}
        </p>
      </div>
      <ChoiceToggles label="Niches" options={CLIENT_NICHE_OPTIONS} value={draft.primaryNicheKeys} onChange={onNiches} disabled={busy} />
      <ChoiceToggles label="Products" options={CLIENT_PRODUCT_OPTIONS} value={draft.primaryProductTypes} onChange={onProducts} disabled={busy} />
      <div>
        <Button type="submit" disabled={busy || !idCheck.valid}>
          {busy ? "Creating…" : "Create client"}
        </Button>
      </div>
    </form>
  );
}

function InformationStep({
  model,
  draft,
  busy,
  errorFor,
  onDraft,
  onSave,
}: {
  model: GuidedOnboardingModel;
  draft: GuidedSetupDraft;
  busy: boolean;
  errorFor: (field: string) => string | undefined;
  onDraft: (patch: Partial<GuidedSetupDraft>) => void;
  onSave: () => void;
}) {
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="guide-display-name">Client name</Label>
          <input id="guide-display-name" className={inputClass} value={draft.clientDisplayName} onChange={(event) => onDraft({ clientDisplayName: event.target.value })} disabled={busy || !model.account} />
          <FieldError message={errorFor("clientDisplayName")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-account-status">Account status</Label>
          <select id="guide-account-status" className={selectClass} value={draft.accountStatus} disabled={busy || !model.account} onChange={(event) => onDraft({ accountStatus: event.target.value as GuidedSetupDraft["accountStatus"] })}>
            <option value="onboarding">Onboarding</option>
            <option value="paused">Paused</option>
            <option value="active">Active account — does not turn on delivery</option>
            <option value="archived">Archived</option>
          </select>
          <p className="text-xs text-slate-500">This is the client account. It does not arm GoHighLevel or Company Sheets.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-email">Email</Label>
          <input id="guide-email" className={inputClass} type="email" value={draft.clientEmail} onChange={(event) => onDraft({ clientEmail: event.target.value })} disabled={busy || !model.setupWritable} />
          <FieldError message={errorFor("clientEmail")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-phone">Phone</Label>
          <input id="guide-phone" className={inputClass} type="tel" value={draft.clientPhone} onChange={(event) => onDraft({ clientPhone: event.target.value })} disabled={busy || !model.setupWritable} />
          <FieldError message={errorFor("clientPhone")} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="guide-geography">Geography</Label>
          <input id="guide-geography" className={inputClass} value={draft.geography} onChange={(event) => onDraft({ geography: event.target.value })} disabled={busy || !model.setupWritable} placeholder="States, regions, or service area" />
        </div>
      </div>
      <ChoiceToggles label="Niches" options={CLIENT_NICHE_OPTIONS} value={draft.primaryNicheKeys} onChange={(primaryNicheKeys) => onDraft({ primaryNicheKeys })} disabled={busy || !model.account} />
      <ChoiceToggles label="Products" options={CLIENT_PRODUCT_OPTIONS} value={draft.primaryProductTypes} onChange={(primaryProductTypes) => onDraft({ primaryProductTypes })} disabled={busy || !model.account} />
      {!model.setupWritable && model.setupUnavailableReason ? <p className="text-sm text-slate-600">{model.setupUnavailableReason}</p> : null}
      <div>
        <Button type="submit" disabled={busy || !model.account}>
          {busy ? "Saving…" : "Save client information"}
        </Button>
      </div>
    </form>
  );
}

function SourcesStep({
  model,
  draft,
  busy,
  errorFor,
  onDraft,
  onSave,
}: {
  model: GuidedOnboardingModel;
  draft: GuidedSetupDraft;
  busy: boolean;
  errorFor: (field: string) => string | undefined;
  onDraft: (patch: Partial<GuidedSetupDraft>) => void;
  onSave: () => void;
}) {
  const locked = busy || !model.setupWritable;
  return (
    <div className="grid gap-4">
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className="text-sm text-slate-600">Choose a source or campaign to copy onto the setup request. Nothing here creates a routing rule or links a source.</p>
      <SourceCampaignReviewPanel
        clientAccountId={model.clientAccountId}
        review={model.sourceCampaignReview}
        draftFunnelId={draft.providerFunnelId}
        draftCampaignId={draft.providerCampaignId}
      />
      <SourceList
        model={model}
        draft={draft}
        locked={locked}
        onDraft={(next) => onDraft(next)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="guide-provider">Source provider</Label>
          <select id="guide-provider" className={selectClass} value={draft.sourceProvider} disabled={locked} onChange={(event) => onDraft({ sourceProvider: event.target.value as GuidedSetupDraft["sourceProvider"] })}>
            <option value="">Not chosen</option>
            <option value="nextgen">NextGen</option>
            <option value="other">Other</option>
            <option value="undecided">Undecided</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-source-name">Source name</Label>
          <input id="guide-source-name" className={inputClass} value={draft.trafficSourceName} disabled={locked} onChange={(event) => onDraft({ trafficSourceName: event.target.value })} />
          <FieldError message={errorFor("trafficSourceName")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-funnel-id">Funnel id</Label>
          <input id="guide-funnel-id" className={inputClass} value={draft.providerFunnelId} disabled={locked} onChange={(event) => onDraft({ providerFunnelId: event.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guide-campaign-id">Campaign id or name</Label>
          <input id="guide-campaign-id" className={inputClass} value={draft.providerCampaignId} disabled={locked} onChange={(event) => onDraft({ providerCampaignId: event.target.value })} />
          <FieldError message={errorFor("providerCampaignId")} />
        </div>
      </div>
      {draft.sourceProvider === "nextgen" ? (
        <p className="text-sm text-slate-600">NextGen funnel URL, test lead, and webhook confirmation stay on the full client setup screen. This step saves the provider and names only.</p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="guide-source-note">Note, if something is missing</Label>
        <textarea id="guide-source-note" className={`${selectClass} min-h-20 py-2`} value={draft.sourceMissingInfoNotes} disabled={locked} onChange={(event) => onDraft({ sourceMissingInfoNotes: event.target.value })} />
      </div>
      <div>
        <Button type="submit" disabled={locked}>
          {busy ? "Saving…" : "Save source request"}
        </Button>
      </div>
    </form>
    <SourceCampaignRequestPanel
      clientAccountId={model.clientAccountId}
      setup={model.setup && !model.setup.repairRequired ? model.setup : null}
      draft={draft}
      review={model.sourceCampaignReview}
      request={model.sourceCampaignRequest}
      busy={busy}
    />
    </div>
  );
}

function SourceList({
  model,
  draft,
  locked,
  onDraft,
}: {
  model: GuidedOnboardingModel;
  draft: GuidedSetupDraft;
  locked: boolean;
  onDraft: (next: GuidedSetupDraft) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="text-sm font-medium text-slate-950">Lead sources already on file</h3>
        {model.sources.availability !== "ready" ? <p className="mt-2 text-sm text-slate-600">The lead-source list is unavailable. Nothing was linked.</p> : null}
        {model.sources.availability === "ready" && model.sources.items.length === 0 ? <p className="mt-2 text-sm text-slate-600">No lead source is listed for this client.</p> : null}
        <ul className="mt-2 space-y-2">
          {model.sources.items.map((source) => (
            <li key={source.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-700">
                {source.label} · {source.associationStatus === "confirmed" ? "Configured" : "Not linked"}
              </span>
              <Button type="button" variant="outline" disabled={locked} onClick={() => onDraft(applyListedSource(draft, source))}>
                Use on the request
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="text-sm font-medium text-slate-950">Campaign rules already on file</h3>
        {model.campaigns.availability !== "ready" ? <p className="mt-2 text-sm text-slate-600">Campaign rules could not be loaded. No rule was created.</p> : null}
        {model.campaigns.availability === "ready" && model.campaigns.rules.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No campaign routing rule is configured. Creating one is not available here.</p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {model.campaigns.rules.map((rule) => (
            <li key={`${rule.label}-${rule.campaignId ?? "name"}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-700">
                {rule.label} · {rule.deliveryEnabled ? "Delivery enabled" : "Routing configured, delivery off"}
              </span>
              <Button type="button" variant="outline" disabled={locked} onClick={() => onDraft(applyListedCampaign(draft, rule))}>
                Record on the request
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DestinationStep({
  model,
  draft,
  busy,
  onDraft,
  onSave,
}: {
  model: GuidedOnboardingModel;
  draft: GuidedSetupDraft;
  busy: boolean;
  onDraft: (patch: Partial<GuidedSetupDraft>) => void;
  onSave: () => void;
}) {
  const locked = busy || !model.setupWritable;
  const selected = draft.destinationChoice === "" || draft.destinationChoice === "undecided" ? "unset" : draft.destinationChoice;
  const options = [
    { value: "ghl", label: "GoHighLevel" },
    { value: "google_sheets", label: "Company Sheets" },
    { value: "both", label: "Both" },
    ...(draft.destinationChoice === "intake_only" ? [{ value: "intake_only", label: "Intake only, already saved" }] : []),
    { value: "unset", label: "Not chosen yet" },
  ];
  return (
    <div className="grid gap-6">
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <fieldset className="grid gap-2" disabled={locked}>
        <legend className="text-sm font-medium text-slate-950">Intended destination</legend>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name="destinationChoice"
              value={option.value}
              checked={selected === option.value}
              onChange={() => onDraft({ destinationChoice: option.value === "unset" ? "" : (option.value as GuidedSetupDraft["destinationChoice"]) })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <DestinationReadout model={model} />
      {!model.setupWritable && model.setupUnavailableReason ? <p className="text-sm text-slate-600">{model.setupUnavailableReason}</p> : null}
      <div>
        <Button type="submit" disabled={locked}>
          {busy ? "Saving…" : "Save destination choice"}
        </Button>
      </div>
    </form>
    <GhlDestinationGuide clientAccountId={model.clientAccountId} />
    </div>
  );
}

function DestinationReadout({ model }: { model: GuidedOnboardingModel }) {
  if (!model.destinations) return <p className="text-sm text-slate-600">Live destination rows could not be read. Configured and active are unknown. Nothing was written.</p>;
  const ghl = model.destinations.ghl;
  const sheets = model.destinations.companySheets;
  return (
    <ul className="space-y-1 text-sm text-slate-700">
      <li>GoHighLevel row: {ghl.configured ? "Configured" : "Not configured"}. Delivery flag: {ghl.deliveryEnabled ? "on" : "off"}. The guide below separates configured, verified, and active.</li>
      <li>
        Company Sheets row: {sheets.configured ? "Configured" : "Not configured"}. Dispatch: {sheets.campaignDispatchEnabled || sheets.agedDispatchEnabled ? "Active" : "Off"}.
      </li>
      <li>Company Sheets is not edited here.</li>
    </ul>
  );
}

function SummaryStep({ model, busy, onSave }: { model: GuidedOnboardingModel; busy: boolean; onSave: () => void }) {
  const facts = guideFacts(model);
  const blockers = guideBlockers(model);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Operational: false. Saving records the setup request. It does not activate delivery.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {facts.map((fact) => (
          <li key={fact.id} data-fact={fact.id} data-state={fact.state} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-slate-950">{fact.label}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATE_CLASS[fact.state]}`}>{labelFor(fact.state)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{fact.detail}</p>
          </li>
        ))}
      </ul>
      <div>
        <h3 className="text-sm font-medium text-slate-950">Still blocked or unavailable</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-slate-600">
        <Link className="font-medium text-sky-800 underline" href={`/clients/${model.clientAccountId}`}>
          Open the client screen
        </Link>{" "}
        for the full setup request, including an unreadable document. Routing rules and live destinations stay there.
      </p>
      <Button type="button" disabled={busy || !model.account} onClick={onSave}>
        {busy ? "Saving…" : "Save setup request"}
      </Button>
    </div>
  );
}
