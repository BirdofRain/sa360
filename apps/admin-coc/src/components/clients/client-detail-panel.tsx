"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createRoutingRuleAction,
  patchClientAction,
  patchClientGhlDestinationAction,
} from "@/app/actions/clients";
import { DeliveryReadinessConfigDrawer } from "@/components/dashboard/delivery-readiness-config-drawer";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientAccountDetail, RoutingMatchType } from "@/lib/clients/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

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

  const dest = client.ghlDestination;
  const readiness = client.destinationReadiness;

  function reload(item: ClientAccountDetail) {
    setClient(item);
    router.refresh();
  }

  function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await patchClientAction(client.clientAccountId, {
        clientDisplayName: String(fd.get("clientDisplayName") ?? ""),
        status: String(fd.get("status") ?? "onboarding"),
        portalEnabled: fd.get("portalEnabled") === "on",
        portalDisplayName: String(fd.get("portalDisplayName") ?? "") || null,
        portalLoginEmail: String(fd.get("portalLoginEmail") ?? "") || null,
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

  function saveDestination(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      destinationSubaccountIdGhl: String(fd.get("destinationSubaccountIdGhl") ?? ""),
      locationName: String(fd.get("locationName") ?? "") || null,
      ghlConnectionStatus: String(fd.get("ghlConnectionStatus") ?? "") || null,
      snapshotInstalled: fd.get("snapshotInstalled") === "on",
      requiredFieldsInstalled: fd.get("requiredFieldsInstalled") === "on",
      defaultAssignedUserIdGhl: String(fd.get("defaultAssignedUserIdGhl") ?? "") || null,
      destinationWorkflowIdGhl: String(fd.get("destinationWorkflowIdGhl") ?? "") || null,
      destinationPipelineIdGhl: String(fd.get("destinationPipelineIdGhl") ?? "") || null,
      destinationPipelineStageIdGhl: String(fd.get("destinationPipelineStageIdGhl") ?? "") || null,
      pipelineStageContactingIdGhl: String(fd.get("pipelineStageContactingIdGhl") ?? "") || null,
      pipelineStageAppointmentSetIdGhl:
        String(fd.get("pipelineStageAppointmentSetIdGhl") ?? "") || null,
      pipelineStageShowedIdGhl: String(fd.get("pipelineStageShowedIdGhl") ?? "") || null,
      pipelineStageSoldIdGhl: String(fd.get("pipelineStageSoldIdGhl") ?? "") || null,
      pipelineStageDeadIdGhl: String(fd.get("pipelineStageDeadIdGhl") ?? "") || null,
      opportunityCreationEnabled: fd.get("opportunityCreationEnabled") === "on",
      backupSheetEnabled: fd.get("backupSheetEnabled") === "on",
      backupSheetId: String(fd.get("backupSheetId") ?? "") || null,
    };
    startTransition(async () => {
      const result = await patchClientGhlDestinationAction(client.clientAccountId, body);
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        reload(result.item);
      }
    });
  }

  function addRoutingRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const master =
      String(fd.get("masterClientAccountId") ?? "").trim() || defaultMasterClientAccountId;
    if (!master) {
      setError("masterClientAccountId is required (set env or enter manually).");
      return;
    }
    const matchType = String(fd.get("matchType") ?? "campaign_id") as RoutingMatchType;
    startTransition(async () => {
      const result = await createRoutingRuleAction({
        masterClientAccountId: master,
        clientAccountId: client.clientAccountId,
        clientDisplayName: client.clientDisplayName,
        destinationSubaccountIdGhl: dest?.destinationSubaccountIdGhl,
        nicheKey: String(fd.get("nicheKey") ?? "") || null,
        productType: String(fd.get("productType") ?? "") || null,
        campaignId: String(fd.get("campaignId") ?? "") || null,
        campaignName: String(fd.get("campaignName") ?? "") || null,
        utmCampaign: String(fd.get("utmCampaign") ?? "") || null,
        matchType,
        priority: Number(fd.get("priority") ?? 100),
        active: true,
      });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        reload(result.item);
        e.currentTarget.reset();
      }
    });
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
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              id="portalEnabled"
              name="portalEnabled"
              defaultChecked={client.portalEnabled}
              disabled={pending}
            />
            <Label htmlFor="portalEnabled">Portal enabled</Label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portalDisplayName">Portal display name</Label>
            <Input
              id="portalDisplayName"
              name="portalDisplayName"
              defaultValue={client.portalDisplayName ?? ""}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portalLoginEmail">Portal login email (placeholder)</Label>
            <Input
              id="portalLoginEmail"
              name="portalLoginEmail"
              type="email"
              defaultValue={client.portalLoginEmail ?? ""}
              disabled={pending}
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              Save profile
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="GHL destination / subaccount"
        description="Opportunity pipeline contract and delivery defaults for this client."
      >
        <form onSubmit={saveDestination} className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="destinationSubaccountIdGhl">GHL location / subaccount ID</Label>
            <Input
              id="destinationSubaccountIdGhl"
              name="destinationSubaccountIdGhl"
              defaultValue={dest?.destinationSubaccountIdGhl ?? ""}
              required={!dest}
              disabled={pending}
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="locationName">Location name</Label>
            <Input
              id="locationName"
              name="locationName"
              defaultValue={dest?.locationName ?? ""}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ghlConnectionStatus">GHL connection status</Label>
            <Input
              id="ghlConnectionStatus"
              name="ghlConnectionStatus"
              placeholder="connected"
              defaultValue={dest?.ghlConnectionStatus ?? ""}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destinationWorkflowIdGhl">Workflow ID</Label>
            <Input
              id="destinationWorkflowIdGhl"
              name="destinationWorkflowIdGhl"
              defaultValue={dest?.destinationWorkflowIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="defaultAssignedUserIdGhl">Assigned user ID</Label>
            <Input
              id="defaultAssignedUserIdGhl"
              name="defaultAssignedUserIdGhl"
              defaultValue={dest?.defaultAssignedUserIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destinationPipelineIdGhl">Pipeline ID</Label>
            <Input
              id="destinationPipelineIdGhl"
              name="destinationPipelineIdGhl"
              defaultValue={dest?.destinationPipelineIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destinationPipelineStageIdGhl">New lead stage ID</Label>
            <Input
              id="destinationPipelineStageIdGhl"
              name="destinationPipelineStageIdGhl"
              defaultValue={dest?.destinationPipelineStageIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pipelineStageContactingIdGhl">Contacting stage ID (optional)</Label>
            <Input
              id="pipelineStageContactingIdGhl"
              name="pipelineStageContactingIdGhl"
              defaultValue={dest?.pipelineStageContactingIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pipelineStageAppointmentSetIdGhl">Appointment set stage ID</Label>
            <Input
              id="pipelineStageAppointmentSetIdGhl"
              name="pipelineStageAppointmentSetIdGhl"
              defaultValue={dest?.pipelineStageAppointmentSetIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pipelineStageShowedIdGhl">Showed stage ID</Label>
            <Input
              id="pipelineStageShowedIdGhl"
              name="pipelineStageShowedIdGhl"
              defaultValue={dest?.pipelineStageShowedIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pipelineStageSoldIdGhl">Sold stage ID</Label>
            <Input
              id="pipelineStageSoldIdGhl"
              name="pipelineStageSoldIdGhl"
              defaultValue={dest?.pipelineStageSoldIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pipelineStageDeadIdGhl">Dead / follow-up stage ID</Label>
            <Input
              id="pipelineStageDeadIdGhl"
              name="pipelineStageDeadIdGhl"
              defaultValue={dest?.pipelineStageDeadIdGhl ?? ""}
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-4 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="snapshotInstalled"
                defaultChecked={dest?.snapshotInstalled}
                disabled={pending}
              />
              Snapshot installed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="requiredFieldsInstalled"
                defaultChecked={dest?.requiredFieldsInstalled}
                disabled={pending}
              />
              Required fields installed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="opportunityCreationEnabled"
                defaultChecked={dest?.opportunityCreationEnabled ?? true}
                disabled={pending}
              />
              Opportunity creation enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="backupSheetEnabled"
                defaultChecked={dest?.backupSheetEnabled}
                disabled={pending}
              />
              Backup sheet enabled
            </label>
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="backupSheetId">Backup sheet ID</Label>
            <Input
              id="backupSheetId"
              name="backupSheetId"
              defaultValue={dest?.backupSheetId ?? ""}
              disabled={pending}
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              Save GHL destination
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="Delivery readiness checklist"
        description="Based on GHL destination defaults (per-rule readiness on each routing rule)."
      >
        {readiness ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">
            Save a GHL subaccount ID to evaluate destination readiness.
          </p>
        )}
      </Section>

      <Section
        title="Campaign routing rules"
        description={`${client.activeRoutingRuleCount} active rule(s). New rules inherit GHL destination defaults.`}
      >
        <ul className="mb-4 space-y-2">
          {client.routingRules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{rule.matchType}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="text-slate-600">
                  {rule.campaignName ?? rule.campaignId ?? rule.utmCampaign ?? rule.id}
                </span>
                <Badge variant="outline" className="ml-2">
                  {rule.readiness.readinessStatus}
                </Badge>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfigRule(rule);
                  setConfigOpen(true);
                }}
              >
                Delivery config
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={addRoutingRule} className="grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-2">
          <p className="text-xs font-medium text-slate-700 md:col-span-2">Add routing rule</p>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="masterClientAccountId">Master client account ID</Label>
            <Input
              id="masterClientAccountId"
              name="masterClientAccountId"
              defaultValue={defaultMasterClientAccountId}
              placeholder="From inbound webhook client_account_id"
              disabled={pending}
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="matchType">Match type</Label>
            <select id="matchType" name="matchType" className={selectClass} disabled={pending}>
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
            <Input id="priority" name="priority" type="number" defaultValue={100} disabled={pending} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nicheKey">Niche key</Label>
            <Input
              id="nicheKey"
              name="nicheKey"
              defaultValue={client.primaryNicheKeys[0] ?? ""}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="productType">Product type</Label>
            <Input
              id="productType"
              name="productType"
              defaultValue={client.primaryProductTypes[0] ?? ""}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="campaignId">Campaign ID</Label>
            <Input id="campaignId" name="campaignId" disabled={pending} className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="campaignName">Campaign name</Label>
            <Input id="campaignName" name="campaignName" disabled={pending} />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="utmCampaign">UTM campaign</Label>
            <Input id="utmCampaign" name="utmCampaign" disabled={pending} />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="secondary" disabled={pending}>
              Add rule
            </Button>
          </div>
        </form>
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

      <DeliveryReadinessConfigDrawer
        rule={configRule}
        open={configOpen}
        onOpenChange={setConfigOpen}
        onUpdated={(item) => {
          setClient((prev) => ({
            ...prev,
            routingRules: prev.routingRules.map((r) => (r.id === item.id ? item : r)),
          }));
        }}
      />
    </div>
  );
}
