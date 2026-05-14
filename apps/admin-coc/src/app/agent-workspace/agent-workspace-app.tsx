"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Check, Clipboard, Loader2 } from "lucide-react";

export type AgentWorkspaceSearchProps = {
  clientAccountId: string;
  locationId?: string;
  contactId?: string;
  leadUid?: string;
  /** When set, sent to guidance API (overrides index-derived niche). */
  nicheKey?: string;
  /** When set, sent to guidance API (overrides context-derived stage). */
  lifecycleStage?: string;
};

type ContextPayload = {
  ok?: boolean;
  identity?: {
    displayName?: string;
    phoneE164?: string;
    email?: string;
    leadUid?: string;
    contactIdGhl?: string;
  };
  lifecycle?: {
    lifecycleStage?: string;
    appointmentStatus?: string;
    policyStatus?: string;
  };
  inboundContactIndex?: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phoneE164?: string;
    email?: string | null;
    state?: string | null;
    leadType?: string | null;
    assignedAgentName?: string | null;
    lifecycleStage?: string | null;
    appointmentStatus?: string | null;
    policyStatus?: string | null;
  } | null;
  attribution?: {
    campaignName?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
  } | null;
  recentLifecycleEvents?: Array<{
    id: string;
    receivedAt: string;
    eventNameInternal: string;
    snapshot?: Record<string, string | undefined>;
  }>;
  recentWebhookLogs?: Array<{
    id: string;
    receivedAt: string;
    processingStatus: string;
    httpStatus?: number | null;
    eventNameInternal?: string | null;
  }>;
  error?: string;
};

type GuidancePayload = {
  ok?: boolean;
  scripts?: GuidanceResource[];
  referralPrompts?: GuidanceResource[];
  policyReviewPrompts?: GuidanceResource[];
  policyDeliveryPrompts?: GuidanceResource[];
  otherResources?: GuidanceResource[];
  objectionPlaybooks?: Array<{
    id: string;
    title: string;
    objectionKey: string;
    recommendedResponse: string;
    followUpMessage?: string | null;
    nextBestAction?: string | null;
  }>;
};

type GuidanceResource = {
  id: string;
  title: string;
  body: string;
  resourceType: string;
  slug: string;
};

const OUTCOMES = [
  { value: "appointment_set", label: "Appointment set" },
  { value: "callback_scheduled", label: "Callback scheduled" },
  { value: "not_interested", label: "Not interested" },
  { value: "no_answer", label: "No answer" },
  { value: "connected_no_result", label: "Connected — no result" },
  { value: "sale_logged", label: "Sale logged" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "other", label: "Other" },
] as const;

const APPT_OPTIONS = ["", "Set", "Confirmed", "Showed", "No-show", "Cancelled", "Rescheduled"];
const POLICY_OPTIONS = ["", "Pending", "In underwriting", "Approved", "Declined", "Sale logged"];

function buildQuery(sp: AgentWorkspaceSearchProps, extra?: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  p.set("clientAccountId", sp.clientAccountId);
  if (sp.locationId?.trim()) p.set("locationId", sp.locationId.trim());
  if (sp.contactId?.trim()) p.set("contactIdGhl", sp.contactId.trim());
  if (sp.leadUid?.trim()) p.set("leadUid", sp.leadUid.trim());
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v?.trim()) p.set(k, v.trim());
    }
  }
  return p.toString();
}

function deriveGuidanceQueryExtras(
  props: AgentWorkspaceSearchProps,
  context: ContextPayload | null
): Record<string, string | undefined> {
  const urlNiche = props.nicheKey?.trim();
  const urlLife = props.lifecycleStage?.trim();
  if (urlNiche || urlLife) {
    const o: Record<string, string | undefined> = {};
    if (urlNiche) o.nicheKey = urlNiche;
    if (urlLife) o.lifecycleStage = urlLife;
    return o;
  }
  if (!context) return {};
  const idxNiche = context.inboundContactIndex?.leadType?.trim();
  const life =
    context.lifecycle?.lifecycleStage?.trim() ||
    context.inboundContactIndex?.lifecycleStage?.trim();
  const o: Record<string, string | undefined> = {};
  if (idxNiche) o.nicheKey = idxNiche;
  if (life) o.lifecycleStage = life;
  return o;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value?.trim() || "—";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{v}</span>
    </div>
  );
}

function GuidanceCard({
  title,
  body,
  suggested,
  resourceId,
  clientAccountId,
  contactId,
  leadUid,
  onUsed,
}: {
  title: string;
  body: string;
  suggested?: string | null;
  resourceId?: string;
  clientAccountId: string;
  contactId?: string;
  leadUid?: string;
  onUsed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const markUsed = async () => {
    if (!resourceId || (!contactId && !leadUid)) return;
    setMarking(true);
    try {
      const res = await fetch("/api/agent-workspace/actions/contact-guidance-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientAccountId,
          contactIdGhl: contactId || undefined,
          leadUid: leadUid || undefined,
          resourceId,
          actionType: "USED",
        }),
      });
      if (res.ok) onUsed();
    } finally {
      setMarking(false);
    }
  };

  return (
    <Card size="sm" className="shadow-none ring-foreground/8">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {suggested ? <CardDescription className="text-xs">{suggested}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-foreground">
          {body}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void copy()}
          >
            {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!resourceId || (!contactId && !leadUid) || marking}
            onClick={() => void markUsed()}
          >
            {marking ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Mark used
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {suggested?.trim()
            ? `Suggested next: ${suggested.trim()}`
            : "Suggested next: use on the next live touch or disposition update."}
        </p>
      </CardContent>
    </Card>
  );
}

export function AgentWorkspaceApp(props: AgentWorkspaceSearchProps) {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [guidance, setGuidance] = useState<GuidancePayload | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [disposition, setDisposition] = useState<string>("no_answer");
  const [apptStatus, setApptStatus] = useState("");
  const [policyStatus, setPolicyStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastGhl, setLastGhl] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const qs = buildQuery(props);
      const cRes = await fetch(`/api/agent-workspace/context?${qs}`, { cache: "no-store" });
      const cText = await cRes.text();
      let cJson: ContextPayload = {};
      try {
        cJson = JSON.parse(cText) as ContextPayload;
      } catch {
        cJson = { error: "Invalid JSON from context API" };
      }
      if (!cRes.ok) {
        setLoadState("error");
        setLoadError(
          typeof cJson.error === "string"
            ? cJson.error
            : `Context ${cRes.status}: ${cText.slice(0, 200)}`
        );
        setContext(null);
        setGuidance(null);
        return;
      }

      const gQs = buildQuery(props, deriveGuidanceQueryExtras(props, cJson));
      const gRes = await fetch(`/api/agent-workspace/guidance?${gQs}`, { cache: "no-store" });
      const gText = await gRes.text();
      let gJson: GuidancePayload = {};
      try {
        gJson = JSON.parse(gText) as GuidancePayload;
      } catch {
        gJson = {};
      }
      if (!gRes.ok) {
        setLoadState("error");
        setLoadError(`Guidance ${gRes.status}: ${gText.slice(0, 200)}`);
        setContext(cJson);
        setGuidance(null);
        return;
      }
      setContext(cJson);
      setGuidance(gJson);
      setLoadState("ready");
    } catch (e) {
      setLoadState("error");
      setLoadError(e instanceof Error ? e.message : "Network error");
    }
  }, [props]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = useMemo(() => {
    const idx = context?.inboundContactIndex;
    const idn = context?.identity;
    return (
      idx?.displayName?.trim() ||
      [idx?.firstName, idx?.lastName].filter(Boolean).join(" ").trim() ||
      idn?.displayName?.trim() ||
      "Lead"
    );
  }, [context]);

  const lifecycleBadge =
    context?.lifecycle?.lifecycleStage ||
    context?.inboundContactIndex?.lifecycleStage ||
    "Unknown stage";

  const submit = async () => {
    setSubmitState("submitting");
    setSubmitError(null);
    try {
      const metadata: Record<string, unknown> = {};
      if (apptStatus.trim()) metadata.sa360_appointment_status = apptStatus.trim();
      if (policyStatus.trim()) metadata.sa360_policy_status = policyStatus.trim();
      if (followUpDate.trim()) metadata.nextFollowUpAt = new Date(followUpDate).toISOString();

      const res = await fetch("/api/agent-workspace/actions/what-happened", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientAccountId: props.clientAccountId,
          locationId: props.locationId,
          contactIdGhl: props.contactId,
          leadUid: props.leadUid,
          outcome: disposition,
          notes: notes.trim() || undefined,
          metadata: Object.keys(metadata).length ? metadata : undefined,
        }),
      });
      const text = await res.text();
      let json: { ok?: boolean; ghlSync?: unknown; error?: string } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        json = {};
      }
      if (!res.ok) {
        setSubmitState("error");
        setSubmitError(json.error ?? text.slice(0, 300));
        return;
      }
      setLastGhl(json.ghlSync ?? null);
      setSubmitState("done");
      void load();
    } catch (e) {
      setSubmitState("error");
      setSubmitError(e instanceof Error ? e.message : "Submit failed");
    }
  };

  const tabResources = (tab: string): GuidanceResource[] => {
    const g = guidance;
    if (!g) return [];
    switch (tab) {
      case "script":
        return g.scripts ?? [];
      case "objections": {
        const obj = (g.otherResources ?? []).filter((r) => r.resourceType === "OBJECTION");
        return obj;
      }
      case "referral":
        return g.referralPrompts ?? [];
      case "policy_review":
        return g.policyReviewPrompts ?? [];
      case "policy_delivery":
        return g.policyDeliveryPrompts ?? [];
      case "follow_up":
        return (g.otherResources ?? []).filter((r) =>
          ["FOLLOW_UP", "UNDERWRITING", "TRUST_BUILDER"].includes(r.resourceType)
        );
      default:
        return [];
    }
  };

  const mergedActivity = useMemo(() => {
    const ev = context?.recentLifecycleEvents ?? [];
    const wh = context?.recentWebhookLogs ?? [];
    const rows: { id: string; at: string; kind: string; title: string; detail: string }[] = [];
    for (const e of ev) {
      rows.push({
        id: `le-${e.id}`,
        at: e.receivedAt,
        kind: "Lifecycle",
        title: e.eventNameInternal,
        detail: e.snapshot?.lifecycleStage ?? "",
      });
    }
    for (const w of wh) {
      rows.push({
        id: `wh-${w.id}`,
        at: w.receivedAt,
        kind: "Webhook",
        title: w.eventNameInternal ?? w.processingStatus,
        detail: `${w.processingStatus}${w.httpStatus != null ? ` · HTTP ${w.httpStatus}` : ""}`,
      });
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return rows.slice(0, 25);
  }, [context]);

  const syncLabel = () => {
    if (submitState === "submitting") return "Saving…";
    if (submitState === "error") return "Save error";
    if (submitState === "done" && lastGhl && typeof lastGhl === "object") {
      const s = lastGhl as { finalStatus?: string; attempted?: boolean; skippedReason?: string };
      if (s.finalStatus === "FAILED") return "GHL sync failed";
      if (s.finalStatus === "SYNCED" && s.attempted === false) return "Saved · GHL off/skipped";
      if (s.finalStatus === "SYNCED") return "Saved · GHL synced";
    }
    if (loadState === "loading") return "Loading…";
    if (loadState === "error") return "Load error";
    return "Live";
  };

  const syncVariant = (): "default" | "destructive" | "secondary" | "outline" => {
    if (submitState === "error" || loadState === "error") return "destructive";
    if (submitState === "submitting" || loadState === "loading") return "secondary";
    if (submitState === "done" && lastGhl && typeof lastGhl === "object") {
      const s = lastGhl as { finalStatus?: string };
      if (s.finalStatus === "FAILED") return "destructive";
    }
    return "outline";
  };

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">SA360 Agent Workspace</h1>
            <p className="text-xs text-muted-foreground">Desktop-first · embed-friendly</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-[min(100vw-2rem,28rem)] truncate text-sm font-medium text-slate-800">
              {loadState === "ready" ? displayName : "—"}
            </span>
            <Badge variant="secondary" className="font-normal">
              {lifecycleBadge}
            </Badge>
            <Badge variant={syncVariant()} className="font-normal">
              {syncLabel()}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 lg:grid lg:grid-cols-12 lg:gap-4 lg:p-6">
        {loadState === "loading" || loadState === "idle" ? (
          <div className="col-span-12 space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : null}

        {loadState === "error" ? (
          <div className="col-span-12 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {loadError ?? "Failed to load workspace data."}
            <div className="mt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && context ? (
          <>
            <section className="order-2 flex flex-col gap-3 lg:order-1 lg:col-span-3">
              <Card className="shadow-none ring-foreground/8">
                <CardHeader>
                  <CardTitle className="text-sm">Lead context</CardTitle>
                  <CardDescription className="text-xs">From SA360 index, lifecycle, and attribution.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Field label="Name" value={displayName} />
                  <Field label="Phone" value={context.inboundContactIndex?.phoneE164 ?? context.identity?.phoneE164} />
                  <Field label="Email" value={context.inboundContactIndex?.email ?? context.identity?.email} />
                  <Field label="State" value={context.inboundContactIndex?.state} />
                  <Field label="Niche / lead type" value={context.inboundContactIndex?.leadType} />
                  <Field label="Assigned agent" value={context.inboundContactIndex?.assignedAgentName} />
                  <Separator />
                  <Field
                    label="Source / campaign"
                    value={
                      context.attribution?.utmCampaign ??
                      context.attribution?.campaignName ??
                      context.attribution?.utmSource
                    }
                  />
                  <Field label="Lifecycle stage" value={context.lifecycle?.lifecycleStage} />
                  <Field label="Appointment status" value={context.lifecycle?.appointmentStatus} />
                  <Field label="Policy status" value={context.lifecycle?.policyStatus} />
                </CardContent>
              </Card>
            </section>

            <section className="order-3 flex flex-col gap-3 lg:order-2 lg:col-span-5">
              <Card className="shadow-none ring-foreground/8">
                <CardHeader>
                  <CardTitle className="text-sm">What happened</CardTitle>
                  <CardDescription className="text-xs">
                    Submits to SA360 and optionally syncs to GoHighLevel when enabled on the API.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {submitError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {submitError}
                    </div>
                  ) : null}
                  <div className="grid gap-2">
                    <Label htmlFor="disposition">Disposition</Label>
                    <select
                      id="disposition"
                      className={cn(
                        "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm",
                        "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      )}
                      value={disposition}
                      onChange={(e) => setDisposition(e.target.value)}
                    >
                      {OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="appt">Appointment status (GHL metadata)</Label>
                      <select
                        id="appt"
                        className={cn(
                          "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm",
                          "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        )}
                        value={apptStatus}
                        onChange={(e) => setApptStatus(e.target.value)}
                      >
                        {APPT_OPTIONS.map((o) => (
                          <option key={o || "unset"} value={o}>
                            {o || "— Unchanged —"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="pol">Policy status (GHL metadata)</Label>
                      <select
                        id="pol"
                        className={cn(
                          "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm",
                          "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        )}
                        value={policyStatus}
                        onChange={(e) => setPolicyStatus(e.target.value)}
                      >
                        {POLICY_OPTIONS.map((o) => (
                          <option key={o || "unset"} value={o}>
                            {o || "— Unchanged —"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="notes">Notes</Label>
                    <textarea
                      id="notes"
                      rows={4}
                      className={cn(
                        "min-h-[96px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm",
                        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      )}
                      placeholder="Call summary, objections, next steps…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fu">Next follow-up date</Label>
                    <Input
                      id="fu"
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={submitState === "submitting"}
                    onClick={() => void submit()}
                    className="w-full gap-2 sm:w-auto"
                  >
                    {submitState === "submitting" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      "Submit outcome"
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-none ring-foreground/8">
                <CardHeader>
                  <CardTitle className="text-sm">Recent activity</CardTitle>
                  <CardDescription className="text-xs">Lifecycle events and GHL webhook requests.</CardDescription>
                </CardHeader>
                <CardContent>
                  {mergedActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent activity for this contact.</p>
                  ) : (
                    <ul className="space-y-2">
                      {mergedActivity.map((row) => (
                        <li
                          key={row.id}
                          className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-snug"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                            <span>{new Date(row.at).toLocaleString()}</span>
                            <span className="font-medium text-foreground">{row.kind}</span>
                          </div>
                          <div className="mt-0.5 font-medium text-foreground">{row.title}</div>
                          {row.detail ? <div className="text-muted-foreground">{row.detail}</div> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="order-4 flex min-h-0 flex-col gap-3 lg:order-3 lg:col-span-4">
              <Card className="flex min-h-[320px] flex-1 flex-col shadow-none ring-foreground/8 lg:min-h-[480px]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Guidance</CardTitle>
                  <CardDescription className="text-xs">Scripts, playbooks, and prompts for this client.</CardDescription>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 px-2 sm:px-4">
                  <Tabs defaultValue="script" className="flex h-full min-h-0 flex-col gap-3">
                    <ScrollArea className="max-h-9 w-full lg:max-h-none">
                      <TabsList variant="line" className="w-full min-w-max flex-nowrap justify-start gap-1 px-1">
                        <TabsTrigger value="script" className="text-xs">
                          Script
                        </TabsTrigger>
                        <TabsTrigger value="objections" className="text-xs">
                          Objections
                        </TabsTrigger>
                        <TabsTrigger value="referral" className="text-xs">
                          Referral
                        </TabsTrigger>
                        <TabsTrigger value="policy_review" className="text-xs">
                          Policy review
                        </TabsTrigger>
                        <TabsTrigger value="policy_delivery" className="text-xs">
                          Policy delivery
                        </TabsTrigger>
                        <TabsTrigger value="follow_up" className="text-xs">
                          Follow-up
                        </TabsTrigger>
                      </TabsList>
                    </ScrollArea>

                    {(["script", "objections", "referral", "policy_review", "policy_delivery", "follow_up"] as const).map(
                      (value) => (
                      <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-hidden">
                        <ScrollArea className="h-[min(50vh,420px)] pr-3 lg:h-[min(calc(100dvh-14rem),560px)]">
                          <div className="space-y-3 pb-4">
                            {value === "objections" && (guidance?.objectionPlaybooks?.length ?? 0) > 0
                              ? guidance!.objectionPlaybooks!.map((pb) => (
                                  <Card key={pb.id} size="sm" className="shadow-none ring-foreground/8">
                                    <CardHeader className="pb-2">
                                      <CardTitle className="text-sm">{pb.title}</CardTitle>
                                      <CardDescription className="text-xs">
                                        {pb.objectionKey.replace(/_/g, " ")}
                                        {pb.nextBestAction ? ` · ${pb.nextBestAction}` : ""}
                                      </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
                                        {pb.recommendedResponse}
                                      </pre>
                                      {pb.followUpMessage ? (
                                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                                          {pb.followUpMessage}
                                        </pre>
                                      ) : null}
                                      <p className="text-[11px] text-muted-foreground">
                                        Copy the response; playbook rows are not linked to a single guidance resource
                                        for “mark used”.
                                      </p>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => void navigator.clipboard.writeText(pb.recommendedResponse)}
                                      >
                                        <Clipboard className="size-3.5" />
                                        Copy response
                                      </Button>
                                    </CardContent>
                                  </Card>
                                ))
                              : null}
                            {tabResources(value).map((r) => (
                              <GuidanceCard
                                key={r.id}
                                title={r.title}
                                body={r.body}
                                suggested={null}
                                resourceId={r.id}
                                clientAccountId={props.clientAccountId}
                                contactId={props.contactId}
                                leadUid={props.leadUid}
                                onUsed={refresh}
                              />
                            ))}
                            {value === "objections" &&
                            (guidance?.objectionPlaybooks?.length ?? 0) === 0 &&
                            tabResources("objections").length === 0 ? (
                              <p className="text-sm text-muted-foreground">No objection playbooks for this client.</p>
                            ) : null}
                            {value !== "objections" && tabResources(value).length === 0 ? (
                              <p className="text-sm text-muted-foreground">No items in this tab.</p>
                            ) : null}
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
