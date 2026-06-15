"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createRoutingRuleAction,
  deleteClientAction,
  deleteRoutingRuleAction,
  patchClientAction,
} from "@/app/actions/clients";
import { ClientGhlDestinationSection } from "@/components/clients/client-ghl-destination-section";
import { RoutingRuleViewDrawer } from "@/components/clients/routing-rule-view-drawer";
import { DeliveryReadinessConfigDrawer } from "@/components/dashboard/delivery-readiness-config-drawer";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientAccountDetail, RoutingMatchType } from "@/lib/clients/types";
import {
  DUPLICATE_ROUTING_RULE_MESSAGE,
  defaultAddRoutingRuleFormValues,
  formAfterAddRoutingRuleApiResult,
  isAddRoutingRuleSubmitBlocked,
  planAddRoutingRuleSubmit,
  type AddRoutingRuleFormValues,
} from "@/lib/clients/routing-rule-form";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function portalLoginUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/portal/login`;
  }
  const base =
    process.env.NEXT_PUBLIC_CLIENT_PORTAL_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SA360_ADMIN_BASE_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/portal/login` : "/portal/login";
}

function PortalConfigSection({
  client,
  pending,
  onSave,
}: {
  client: ClientAccountDetail;
  pending: boolean;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const loginUrl = portalLoginUrl();
  const portalStatus = client.portalEnabled
    ? client.status === "paused" || client.status === "archived"
      ? "disabled"
      : "active"
    : "disabled";

  async function copyLoginUrl() {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section
      title="Client portal"
      description="Maps portal login email to this client account. Metrics on /portal are scoped to this clientAccountId."
    >
      <form key={client.updatedAt} onSubmit={onSave} className="grid gap-3 md:grid-cols-2">
        <div className="flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            id="portalEnabled"
            name="portalEnabled"
            defaultChecked={client.portalEnabled}
            disabled={pending}
          />
          <Label htmlFor="portalEnabled">Portal enabled</Label>
          <Badge variant={portalStatus === "active" ? "default" : "secondary"}>
            {portalStatus === "active" ? "Active" : "Disabled"}
          </Badge>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="portalDisplayName">Portal display name</Label>
          <Input
            id="portalDisplayName"
            name="portalDisplayName"
            placeholder={client.clientDisplayName}
            defaultValue={client.portalDisplayName ?? ""}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="portalLoginEmail">Portal login email</Label>
          <Input
            id="portalLoginEmail"
            name="portalLoginEmail"
            type="email"
            autoComplete="off"
            defaultValue={client.portalLoginEmail ?? ""}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5 md:col-span-2">
          <Label>Portal login URL</Label>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800">{loginUrl}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLoginUrl()}>
              {copied ? "Copied" : "Copy portal login URL"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Phase 5B maps login email to this client account. Portal password is still configured by
          server env (<code className="text-[11px]">CLIENT_PORTAL_LOGIN_PASSWORD</code>) unless
          per-client passwords are added later.
        </p>
        <div className="md:col-span-2">
          <Button type="submit" disabled={pending}>
            Save portal settings
          </Button>
        </div>
      </form>
    </Section>
  );
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ClientDetailPanel({
  initialClient,
  defaultMasterClientAccountId,
}: {
  initialClient: ClientAccountDetail;
  defaultMasterClientAccountId: string;
}) {
  const router = useRouter();
  const [client, setClient] = useState(initialClient);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [configRule, setConfigRule] = useState<RoutingRuleWithReadinessItem | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [viewRule, setViewRule] = useState<RoutingRuleWithReadinessItem | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [ruleForm, setRuleForm] = useState<AddRoutingRuleFormValues>(() =>
    defaultAddRoutingRuleFormValues({
      defaultMasterClientAccountId,
      primaryNicheKey: initialClient.primaryNicheKeys[0],
      primaryProductType: initialClient.primaryProductTypes[0],
    })
  );
  const [ruleFormPending, setRuleFormPending] = useState(false);
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [ruleFormSuccess, setRuleFormSuccess] = useState<string | null>(null);

  const dest = client.ghlDestination;
  const readiness = client.destinationReadiness;

  function reload(item: ClientAccountDetail, refreshPage = false) {
    setClient(item);
    if (refreshPage) router.refresh();
  }

  function deleteRule(rule: RoutingRuleWithReadinessItem) {
    const label =
      rule.campaignName ?? rule.campaignId ?? rule.utmCampaign ?? rule.matchType;
    if (
      !window.confirm(
        `Delete routing rule "${label}" (${rule.id})? This cannot be undone. Dry-run history may still reference this rule ID.`
      )
    ) {
      return;
    }
    setDeletePending(true);
    setError(null);
    startTransition(async () => {
      const res = await deleteRoutingRuleAction(rule.id);
      setDeletePending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setViewOpen(false);
      setConfigOpen(false);
      setClient((prev) => {
        const routingRules = prev.routingRules.filter((r) => r.id !== rule.id);
        return {
          ...prev,
          routingRules,
          activeRoutingRuleCount: routingRules.filter((r) => r.active).length,
        };
      });
    });
  }

  function deleteClientAccount() {
    if (
      !window.confirm(
        `Delete client "${client.clientDisplayName}" (${client.clientAccountId}) and ALL ${client.routingRules.length} routing rule(s)? GHL OAuth connections will be unlinked, not deleted.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteClientAction(client.clientAccountId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/clients");
    });
  }

  function savePortal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await patchClientAction(client.clientAccountId, {
        portalEnabled: fd.get("portalEnabled") === "on",
        portalDisplayName: String(fd.get("portalDisplayName") ?? "") || null,
        portalLoginEmail: String(fd.get("portalLoginEmail") ?? "") || null,
      });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        reload(result.item);
      }
    });
  }

  function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await patchClientAction(client.clientAccountId, {
        clientDisplayName: String(fd.get("clientDisplayName") ?? ""),
        status: String(fd.get("status") ?? "onboarding"),
        notes: String(fd.get("notes") ?? "") || null,
        primaryNicheKeys: String(fd.get("primaryNicheKeys") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        primaryProductTypes: String(fd.get("primaryProductTypes") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        reload(result.item);
      }
    });
  }

  function addRoutingRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isAddRoutingRuleSubmitBlocked(ruleFormPending)) return;

    setRuleFormError(null);
    setRuleFormSuccess(null);

    const plan = planAddRoutingRuleSubmit({
      form: ruleForm,
      existingRules: client.routingRules,
      clientAccountId: client.clientAccountId,
      clientDisplayName: client.clientDisplayName,
      destinationSubaccountIdGhl: dest?.destinationSubaccountIdGhl,
      defaultMasterClientAccountId,
      primaryNicheKey: client.primaryNicheKeys[0],
      primaryProductType: client.primaryProductTypes[0],
    });

    if (plan.status === "duplicate") {
      setRuleFormError(DUPLICATE_ROUTING_RULE_MESSAGE);
      return;
    }
    if (plan.status === "invalid") {
      setRuleFormError(plan.error);
      return;
    }

    setRuleFormPending(true);
    startTransition(async () => {
      try {
        const result = await createRoutingRuleAction(plan.createBody);
        if (!result.ok) {
          setRuleFormError(result.error);
          return;
        }
        setError(null);
        setRuleForm(
          formAfterAddRoutingRuleApiResult({
            currentForm: ruleForm,
            clearedForm: plan.clearedForm,
            apiOk: true,
          })
        );
        setRuleFormSuccess("Routing rule created.");
        reload(result.item, true);
      } finally {
        setRuleFormPending(false);
      }
    });
  }

  function updateRuleFormField<K extends keyof AddRoutingRuleFormValues>(
    field: K,
    value: AddRoutingRuleFormValues[K]
  ) {
    setRuleForm((prev) => ({ ...prev, [field]: value }));
    setRuleFormError(null);
    setRuleFormSuccess(null);
  }

  return (
    <div className="space-y-4">
      <WarningBanner tone="info" title="Config only — no delivery">
        Saving client or routing settings updates the database only. No GHL contacts, workflows,
        sheets, or live delivery runs from this page.
      </WarningBanner>

      {error ? (
        <WarningBanner tone="warn" title="Save failed">
          {error}
        </WarningBanner>
      ) : null}

      <Section title="Client profile" description="Portal and tenant metadata.">
        <form onSubmit={saveProfile} className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Client account ID</Label>
            <Input value={client.clientAccountId} disabled className="font-mono" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="clientDisplayName">Display name</Label>
            <Input
              id="clientDisplayName"
              name="clientDisplayName"
              defaultValue={client.clientDisplayName}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              className={selectClass}
              defaultValue={client.status}
              disabled={pending}
            >
              <option value="onboarding">onboarding</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="primaryNicheKeys">Primary niches</Label>
            <Input
              id="primaryNicheKeys"
              name="primaryNicheKeys"
              defaultValue={client.primaryNicheKeys.join(", ")}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="primaryProductTypes">Primary products</Label>
            <Input
              id="primaryProductTypes"
              name="primaryProductTypes"
              defaultValue={client.primaryProductTypes.join(", ")}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" defaultValue={client.notes ?? ""} disabled={pending} />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              Save profile
            </Button>
          </div>
        </form>
      </Section>

      <PortalConfigSection client={client} pending={pending} onSave={savePortal} />

      <ClientGhlDestinationSection
        client={client}
        pending={pending}
        onUpdated={(item) => reload(item, true)}
      />

      {readiness ? (
        <Section
          title="Destination readiness"
          description="Source-independent: can SA360 safely write a normalized lead to this GHL location?"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{readiness.readinessStatus}</Badge>
              <span className="text-xs text-muted-foreground">{readiness.recommendedNextAction}</span>
            </div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {readiness.checklist.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-xs"
                >
                  <span aria-hidden>{item.complete ? "✓" : "○"}</span>
                  <span>
                    <span className="font-medium">{item.label}</span>
                    {item.detail ? (
                      <span className="block text-muted-foreground">{item.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}

      <Section
        title="Campaign routing rules"
        description={`${client.routingRules.length} rule(s), ${client.activeRoutingRuleCount} active. View, configure, or delete rules.`}
      >
        {client.routingRules.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">No routing rules yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {client.routingRules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{rule.matchType}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-slate-600">
                    {rule.campaignName ?? rule.campaignId ?? rule.utmCampaign ?? "—"}
                  </span>
                  <Badge variant="outline" className="ml-2">
                    {rule.readiness.readinessStatus}
                  </Badge>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{rule.id}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setViewRule(rule);
                      setViewOpen(true);
                    }}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConfigRule(rule);
                      setConfigOpen(true);
                    }}
                  >
                    Config
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending || deletePending}
                    onClick={() => deleteRule(rule)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addRoutingRule} className="grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-2">
          <p className="text-xs font-medium text-slate-700 md:col-span-2">Add routing rule</p>
          {ruleFormError ? (
            <p className="text-sm text-amber-900 md:col-span-2" role="alert">
              {ruleFormError}
            </p>
          ) : null}
          {ruleFormSuccess ? (
            <p className="text-sm text-emerald-800 md:col-span-2" role="status">
              {ruleFormSuccess}
            </p>
          ) : null}
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="masterClientAccountId">Master client account ID</Label>
            <Input
              id="masterClientAccountId"
              name="masterClientAccountId"
              value={ruleForm.masterClientAccountId}
              onChange={(ev) => updateRuleFormField("masterClientAccountId", ev.target.value)}
              placeholder="From inbound webhook client_account_id"
              disabled={ruleFormPending || pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="matchType">Match type</Label>
            <select
              id="matchType"
              name="matchType"
              className={selectClass}
              value={ruleForm.matchType}
              onChange={(ev) =>
                updateRuleFormField("matchType", ev.target.value as RoutingMatchType)
              }
              disabled={ruleFormPending || pending}
            >
              <option value="campaign_id">campaign_id</option>
              <option value="adset_id">adset_id</option>
              <option value="ad_id">ad_id</option>
              <option value="utm_campaign">utm_campaign</option>
              <option value="form_id_utm_campaign">form_id_utm_campaign</option>
              <option value="keyword_fallback">keyword_fallback</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              value={ruleForm.priority}
              onChange={(ev) => updateRuleFormField("priority", ev.target.value)}
              disabled={ruleFormPending || pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nicheKey">Niche key</Label>
            <Input
              id="nicheKey"
              name="nicheKey"
              value={ruleForm.nicheKey}
              onChange={(ev) => updateRuleFormField("nicheKey", ev.target.value)}
              disabled={ruleFormPending || pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="productType">Product type</Label>
            <Input
              id="productType"
              name="productType"
              value={ruleForm.productType}
              onChange={(ev) => updateRuleFormField("productType", ev.target.value)}
              disabled={ruleFormPending || pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="campaignId">Campaign ID</Label>
            <Input
              id="campaignId"
              name="campaignId"
              value={ruleForm.campaignId}
              onChange={(ev) => updateRuleFormField("campaignId", ev.target.value)}
              disabled={ruleFormPending || pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="campaignName">Campaign name</Label>
            <Input
              id="campaignName"
              name="campaignName"
              value={ruleForm.campaignName}
              onChange={(ev) => updateRuleFormField("campaignName", ev.target.value)}
              disabled={ruleFormPending || pending}
            />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="utmCampaign">UTM campaign</Label>
            <Input
              id="utmCampaign"
              name="utmCampaign"
              value={ruleForm.utmCampaign}
              onChange={(ev) => updateRuleFormField("utmCampaign", ev.target.value)}
              disabled={ruleFormPending || pending}
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="secondary" disabled={ruleFormPending || pending}>
              {ruleFormPending ? "Adding rule…" : "Add rule"}
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Danger zone">
        <p className="mb-3 text-sm text-muted-foreground">
          Deletes this client profile, GHL destination row, and all routing rules. Historical
          dry-run rows are not removed.
        </p>
        <Button type="button" variant="destructive" disabled={pending} onClick={deleteClientAccount}>
          Delete client
        </Button>
      </Section>

      <Section title="Related tools">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/routing-dry-run?clientAccountId=${encodeURIComponent(client.clientAccountId)}`}
            className="text-sky-700 hover:underline"
          >
            Routing dry run
          </Link>
          <Link
            href={`/delivery-readiness?clientAccountId=${encodeURIComponent(client.clientAccountId)}`}
            className="text-sky-700 hover:underline"
          >
            Delivery readiness
          </Link>
        </div>
      </Section>

      <RoutingRuleViewDrawer
        rule={viewRule}
        open={viewOpen}
        onOpenChange={setViewOpen}
        deletePending={deletePending}
        onConfigure={() => {
          if (viewRule) {
            setConfigRule(viewRule);
            setConfigOpen(true);
            setViewOpen(false);
          }
        }}
        onDelete={() => {
          if (viewRule) deleteRule(viewRule);
        }}
      />

      <DeliveryReadinessConfigDrawer
        rule={configRule}
        open={configOpen}
        onOpenChange={setConfigOpen}
        onUpdated={(item) => {
          setClient((prev) => ({
            ...prev,
            routingRules: prev.routingRules.map((r) => (r.id === item.id ? item : r)),
          }));
          setViewRule((r) => (r?.id === item.id ? item : r));
        }}
      />
    </div>
  );
}
