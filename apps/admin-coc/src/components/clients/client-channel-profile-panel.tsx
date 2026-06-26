"use client";

import { useMemo, useState, useTransition } from "react";

import type {
  ImpactPreviewResult,
  SaveChannelProfileResult,
  ValidateReadinessResult,
} from "@/app/actions/channel-profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHANNEL_AI_PROVIDERS,
  CHANNEL_APPLY_SCOPES,
  CHANNEL_DEFAULT_LEAD_CHANNELS,
  CHANNEL_FALLBACK_CHANNELS,
  CHANNEL_HEALTH_STATUSES,
  CHANNEL_PREFERRED_CONTACT_WINDOWS,
  CHANNEL_WRITE_MODES,
  type ChannelApplyScope,
  type ChannelImpactPreview,
  type ChannelProfile,
  type ChannelProfileSaveInput,
  type ChannelProfileValidationDetail,
  type ChannelReadinessReport,
  type ChannelReadinessStatus,
  type ChannelWriteModeInfo,
} from "@/lib/clients/channel-profile-types";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function readinessBadgeClass(status: ChannelReadinessStatus): string {
  switch (status) {
    case "READY":
      return "border-emerald-600/40 bg-emerald-50 text-emerald-900";
    case "PARTIAL":
      return "border-amber-600/40 bg-amber-50 text-amber-950";
    case "MISSING_CONFIG":
      return "border-red-600/40 bg-red-50 text-red-900";
    default:
      return "border-slate-400/40 bg-slate-50 text-slate-700";
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 rounded border-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function bucketValue(b: { count: number | null }): string {
  return b.count == null ? "—" : String(b.count);
}

export type ChannelProfilePanelActions = {
  saveAction: (
    clientAccountId: string,
    body: ChannelProfileSaveInput
  ) => Promise<SaveChannelProfileResult>;
  validateAction: (
    clientAccountId: string,
    subaccountIdGhl?: string | null
  ) => Promise<ValidateReadinessResult>;
  impactAction: (
    clientAccountId: string,
    opts?: { subaccountIdGhl?: string | null; applyScope?: string | null }
  ) => Promise<ImpactPreviewResult>;
};

export function ClientChannelProfilePanel({
  clientAccountId,
  initialProfile,
  initialWriteMode,
  initialReadiness,
  saveAction,
  validateAction,
  impactAction,
}: {
  clientAccountId: string;
  initialProfile: ChannelProfile;
  initialWriteMode: ChannelWriteModeInfo;
  initialReadiness: ChannelReadinessReport;
} & ChannelProfilePanelActions) {
  const [profile, setProfile] = useState<ChannelProfile>(initialProfile);
  const [writeModeInfo, setWriteModeInfo] = useState<ChannelWriteModeInfo>(initialWriteMode);
  const [readiness, setReadiness] = useState<ChannelReadinessReport>(initialReadiness);
  const [impact, setImpact] = useState<ChannelImpactPreview | null>(null);

  const [validationIssues, setValidationIssues] = useState<ChannelProfileValidationDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [savePending, startSave] = useTransition();
  const [readinessPending, startReadiness] = useTransition();
  const [impactPending, startImpact] = useTransition();

  const subaccountIdGhl = initialProfile.subaccountIdGhl;
  const forceMigrate = profile.applyDefaultScope === "FORCE_MIGRATE_SELECTED";

  function set<K extends keyof ChannelProfile>(key: K, value: ChannelProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  const issueFor = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of validationIssues) {
      const list = map.get(issue.field) ?? [];
      list.push(issue.message);
      map.set(issue.field, list);
    }
    return map;
  }, [validationIssues]);

  function buildSaveInput(): ChannelProfileSaveInput {
    return {
      subaccountIdGhl: subaccountIdGhl ?? undefined,
      blueEnabled: profile.blueEnabled,
      greenEnabled: profile.greenEnabled,
      voiceEnabled: profile.voiceEnabled,
      closebotEnabled: profile.closebotEnabled,
      ghlAiEnabled: profile.ghlAiEnabled,
      aiProvider: profile.aiProvider,
      defaultLeadChannel: profile.defaultLeadChannel,
      fallbackChannel: profile.fallbackChannel,
      requiresSameNumberContinuity: profile.requiresSameNumberContinuity,
      blueNumber: profile.blueNumber,
      greenNumber: profile.greenNumber,
      voiceNumber: profile.voiceNumber,
      blueHealthStatus: profile.blueHealthStatus,
      greenHealthStatus: profile.greenHealthStatus,
      sendblueMaxNoReplyAttempts: profile.sendblueMaxNoReplyAttempts,
      sendblueWindowDays: profile.sendblueWindowDays,
      textStartHour: profile.textStartHour,
      textEndHour: profile.textEndHour,
      preferredContactWindow: profile.preferredContactWindow,
      applyDefaultScope: profile.applyDefaultScope,
      // Force migrate is simulation-only in this version.
      writeMode: forceMigrate ? "simulate" : profile.writeMode,
    };
  }

  function onSave() {
    setError(null);
    setValidationIssues([]);
    startSave(async () => {
      const res = await saveAction(clientAccountId, buildSaveInput());
      if (!res.ok) {
        setError(res.error);
        setValidationIssues(res.details ?? []);
        return;
      }
      setProfile(res.data.profile);
      setWriteModeInfo(res.data.writeMode);
      setSavedAt(res.data.profile.updatedAt);
    });
  }

  function onValidate() {
    setError(null);
    startReadiness(async () => {
      const res = await validateAction(clientAccountId, subaccountIdGhl);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReadiness(res.readiness);
    });
  }

  function onPreviewImpact() {
    setError(null);
    startImpact(async () => {
      const res = await impactAction(clientAccountId, {
        subaccountIdGhl,
        applyScope: profile.applyDefaultScope,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImpact(res.preview);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
        <p className="font-medium">How these settings apply</p>
        <ul className="mt-1 list-inside list-disc text-xs">
          <li>
            <strong>Save Profile</strong> updates the SA360 database (source of truth). It does not
            write to GHL.
          </li>
          <li>Client settings affect new routing by default; existing leads are not mutated.</li>
          <li>
            Live GHL custom-value writes only happen via <strong>Apply Profile to GHL</strong> (in
            the GHL Profile Mirror card below) when the effective mode is <code>live</code> and the
            allowlist passes.
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={cn("w-fit", readinessBadgeClass(readiness.status))}>
          GHL readiness: {readiness.status}
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          write mode: {writeModeInfo.effectiveWriteMode}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          env max: {writeModeInfo.maxWriteMode}
        </Badge>
        {writeModeInfo.clamped ? (
          <Badge variant="outline" className="border-amber-600/40 bg-amber-50 text-amber-950">
            clamped to env max
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Last validated: {fmtDate(readiness.snapshotFetchedAt ?? profile.lastValidatedAt)} · Last
          saved: {fmtDate(savedAt ?? profile.updatedAt)}
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Please fix the following:</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {validationIssues.map((i) => (
              <li key={`${i.field}:${i.message}`}>{i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title="Channels" description="Enable the lines and AI/voice features for this client.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle label="Blue enabled" checked={profile.blueEnabled} onChange={(v) => set("blueEnabled", v)} />
          <Toggle label="Green enabled" checked={profile.greenEnabled} onChange={(v) => set("greenEnabled", v)} />
          <Toggle label="Voice enabled" checked={profile.voiceEnabled} onChange={(v) => set("voiceEnabled", v)} />
          <Toggle label="CloseBot enabled" checked={profile.closebotEnabled} onChange={(v) => set("closebotEnabled", v)} />
          <Toggle label="GHL AI enabled" checked={profile.ghlAiEnabled} onChange={(v) => set("ghlAiEnabled", v)} />
          <Toggle
            label="Require same-number continuity"
            checked={profile.requiresSameNumberContinuity}
            onChange={(v) => set("requiresSameNumberContinuity", v)}
          />
        </div>
        {issueFor.has("channels") ? (
          <p className="mt-2 text-xs text-destructive">{issueFor.get("channels")!.join(" ")}</p>
        ) : null}
      </Section>

      <Section title="Routing & AI">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>AI provider</Label>
            <select
              className={SELECT_CLASS}
              value={profile.aiProvider}
              onChange={(e) => set("aiProvider", e.target.value as ChannelProfile["aiProvider"])}
            >
              {CHANNEL_AI_PROVIDERS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {issueFor.has("aiProvider") ? (
              <p className="mt-1 text-xs text-destructive">{issueFor.get("aiProvider")!.join(" ")}</p>
            ) : null}
          </div>
          <div>
            <Label>Default lead channel</Label>
            <select
              className={SELECT_CLASS}
              value={profile.defaultLeadChannel}
              onChange={(e) =>
                set("defaultLeadChannel", e.target.value as ChannelProfile["defaultLeadChannel"])
              }
            >
              {CHANNEL_DEFAULT_LEAD_CHANNELS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {issueFor.has("defaultLeadChannel") ? (
              <p className="mt-1 text-xs text-destructive">
                {issueFor.get("defaultLeadChannel")!.join(" ")}
              </p>
            ) : null}
          </div>
          <div>
            <Label>Fallback channel</Label>
            <select
              className={SELECT_CLASS}
              value={profile.fallbackChannel}
              onChange={(e) =>
                set("fallbackChannel", e.target.value as ChannelProfile["fallbackChannel"])
              }
            >
              {CHANNEL_FALLBACK_CHANNELS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {issueFor.has("fallbackChannel") ? (
              <p className="mt-1 text-xs text-destructive">
                {issueFor.get("fallbackChannel")!.join(" ")}
              </p>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Numbers & health">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Blue number</Label>
            <Input
              value={profile.blueNumber ?? ""}
              onChange={(e) => set("blueNumber", e.target.value || null)}
              placeholder="+1…"
            />
          </div>
          <div>
            <Label>Green number</Label>
            <Input
              value={profile.greenNumber ?? ""}
              onChange={(e) => set("greenNumber", e.target.value || null)}
              placeholder="+1…"
            />
          </div>
          <div>
            <Label>Voice number</Label>
            <Input
              value={profile.voiceNumber ?? ""}
              onChange={(e) => set("voiceNumber", e.target.value || null)}
              placeholder="+1…"
            />
          </div>
          <div>
            <Label>Blue health status</Label>
            <select
              className={SELECT_CLASS}
              value={profile.blueHealthStatus ?? ""}
              onChange={(e) =>
                set(
                  "blueHealthStatus",
                  (e.target.value || null) as ChannelProfile["blueHealthStatus"]
                )
              }
            >
              <option value="">—</option>
              {CHANNEL_HEALTH_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Green health status</Label>
            <select
              className={SELECT_CLASS}
              value={profile.greenHealthStatus ?? ""}
              onChange={(e) =>
                set(
                  "greenHealthStatus",
                  (e.target.value || null) as ChannelProfile["greenHealthStatus"]
                )
              }
            >
              <option value="">—</option>
              {CHANNEL_HEALTH_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Sendblue cadence & contact window">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Max no-reply attempts before fallback</Label>
            <Input
              type="number"
              value={profile.sendblueMaxNoReplyAttempts}
              onChange={(e) => set("sendblueMaxNoReplyAttempts", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Fallback window (days)</Label>
            <Input
              type="number"
              value={profile.sendblueWindowDays}
              onChange={(e) => set("sendblueWindowDays", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Text start hour (0–23)</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={profile.textStartHour}
              onChange={(e) => set("textStartHour", Number(e.target.value))}
            />
            {issueFor.has("textStartHour") ? (
              <p className="mt-1 text-xs text-destructive">
                {issueFor.get("textStartHour")!.join(" ")}
              </p>
            ) : null}
          </div>
          <div>
            <Label>Text end hour (0–23)</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={profile.textEndHour}
              onChange={(e) => set("textEndHour", Number(e.target.value))}
            />
            {issueFor.has("textEndHour") ? (
              <p className="mt-1 text-xs text-destructive">
                {issueFor.get("textEndHour")!.join(" ")}
              </p>
            ) : null}
          </div>
          <div>
            <Label>Preferred contact window</Label>
            <select
              className={SELECT_CLASS}
              value={profile.preferredContactWindow}
              onChange={(e) =>
                set(
                  "preferredContactWindow",
                  e.target.value as ChannelProfile["preferredContactWindow"]
                )
              }
            >
              {CHANNEL_PREFERRED_CONTACT_WINDOWS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section
        title="Apply changes to"
        description="Existing leads are never mutated automatically in this version."
      >
        <div className="space-y-2">
          {CHANNEL_APPLY_SCOPES.map((scope) => (
            <label key={scope} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="applyDefaultScope"
                className="mt-0.5 size-4"
                checked={profile.applyDefaultScope === scope}
                onChange={() => set("applyDefaultScope", scope as ChannelApplyScope)}
              />
              <span>
                <span className="font-medium">
                  {scope === "NEW_LEADS_ONLY"
                    ? "New leads only"
                    : scope === "ACTIVE_UNLOCKED_ONLY"
                      ? "Active unlocked leads only"
                      : "Force migrate selected leads"}
                </span>
                {scope === "ACTIVE_UNLOCKED_ONLY" ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (saved as intended scope — remains dry-run/simulate in this version)
                  </span>
                ) : null}
                {scope === "FORCE_MIGRATE_SELECTED" ? (
                  <span className="ml-1 text-xs text-amber-800">
                    (simulation-only — write mode is forced to simulate)
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3">
          <Label>Write mode</Label>
          <select
            className={cn(SELECT_CLASS, "max-w-[200px]")}
            value={forceMigrate ? "simulate" : profile.writeMode}
            disabled={forceMigrate}
            onChange={(e) => set("writeMode", e.target.value as ChannelProfile["writeMode"])}
          >
            {CHANNEL_WRITE_MODES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved write mode is clamped to the environment maximum ({writeModeInfo.maxWriteMode}).
          </p>
          {issueFor.has("applyDefaultScope") ? (
            <p className="mt-1 text-xs text-destructive">
              {issueFor.get("applyDefaultScope")!.join(" ")}
            </p>
          ) : null}
        </div>
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onSave} disabled={savePending}>
          {savePending ? "Saving…" : "Save Profile"}
        </Button>
        <Button type="button" variant="secondary" onClick={onValidate} disabled={readinessPending}>
          {readinessPending ? "Validating…" : "Validate GHL Readiness"}
        </Button>
        <Button type="button" variant="outline" onClick={onPreviewImpact} disabled={impactPending}>
          {impactPending ? "Loading…" : "Preview Existing Lead Impact"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Saving updates SA360 only. To mirror these settings into GHL custom values, use the GHL
        Profile Mirror card below.
      </p>

      <Section title="GHL readiness">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("w-fit", readinessBadgeClass(readiness.status))}>
            {readiness.status}
          </Badge>
          {readiness.locationId ? (
            <span className="font-mono text-xs text-muted-foreground">{readiness.locationId}</span>
          ) : (
            <span className="text-xs text-muted-foreground">No GHL location linked</span>
          )}
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Installed fields ({readiness.installedFields.length})
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-emerald-800 dark:text-emerald-300">
              {readiness.installedFields.length === 0 ? (
                <li className="text-muted-foreground">None detected</li>
              ) : (
                readiness.installedFields.map((f) => <li key={f}>✓ {f}</li>)
              )}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Missing fields ({readiness.missingFields.length})
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
              {readiness.missingFields.length === 0 ? (
                <li className="text-muted-foreground">None</li>
              ) : (
                readiness.missingFields.map((f) => <li key={f}>○ {f}</li>)
              )}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Missing custom values ({readiness.missingCustomValues.length})
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
              {readiness.missingCustomValues.map((f) => (
                <li key={f}>○ {f}</li>
              ))}
            </ul>
          </div>
        </div>
        {readiness.warnings.length > 0 || readiness.notes.length > 0 ? (
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {readiness.warnings.map((w) => (
              <p key={w} className="text-amber-800">
                ⚠ {w}
              </p>
            ))}
            {readiness.notes.map((n) => (
              <p key={n}>· {n}</p>
            ))}
          </div>
        ) : null}
      </Section>

      {impact ? (
        <Section title="Existing lead impact preview" description={impact.message}>
          {!impact.available ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {impact.message}
            </p>
          ) : (
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <ImpactRow label="Total indexed contacts" value={String(impact.totalIndexedContacts)} />
              <ImpactRow label="New leads affected" bucket={impact.buckets.newLeadsAffected} />
              <ImpactRow
                label="Active locked leads"
                bucket={impact.buckets.activeLockedLeadsAffected}
              />
              <ImpactRow
                label="Active unlocked leads"
                bucket={impact.buckets.activeUnlockedLeadsAffected}
              />
              <ImpactRow
                label="Eligible for recalculation"
                bucket={impact.buckets.eligibleForRecalculation}
              />
              <ImpactRow label="Requires review" bucket={impact.buckets.requiresReview} />
              <ImpactRow
                label="Skipped (channel locked)"
                bucket={impact.buckets.skippedChannelLocked}
              />
              <ImpactRow
                label="Skipped (DNC/dead/bad number)"
                bucket={impact.buckets.skippedDncDeadOrBadNumber}
              />
            </div>
          )}
          {impact.notes.map((n) => (
            <p key={n} className="mt-2 text-xs text-muted-foreground">
              · {n}
            </p>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function ImpactRow({
  label,
  value,
  bucket,
}: {
  label: string;
  value?: string;
  bucket?: { count: number | null; note?: string };
}) {
  const display = value ?? (bucket ? bucketValue(bucket) : "—");
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{display}</p>
      {bucket?.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{bucket.note}</p> : null}
    </div>
  );
}
