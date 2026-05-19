"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Copy, Loader2 } from "lucide-react";

import type {
  AdminWebhookDetail,
  AdminWebhookListItem,
  WebhookDetailFieldValue,
  WebhookRequestDetailDebug,
} from "@/lib/admin-api/types";
import {
  buildCompactDebugSummary,
  copyTextToClipboard,
  formatDetailFieldValue,
  topLineFromListItem,
} from "@/lib/webhook-monitor-detail.utils";
import { isInvalidWebhookRow } from "@/lib/webhook-monitor-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  stringifyWebhookJson,
  webhookRawJsonEmptyMessage,
  webhookRawJsonTabPayload,
  type WebhookRawJsonTab,
} from "@/lib/webhook-raw-json.utils";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function validityBadge(validity: "valid" | "invalid") {
  if (validity === "invalid") {
    return <Badge variant="destructive">invalid</Badge>;
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100"
    >
      valid
    </Badge>
  );
}

function httpBadge(http: string | null) {
  if (!http) return <span className="text-muted-foreground">—</span>;
  const code = Number(http);
  const bad = Number.isFinite(code) && code >= 400;
  return (
    <Badge variant={bad ? "destructive" : "outline"} className="font-mono tabular-nums">
      {http}
    </Badge>
  );
}

function statusBadgeClass(processingStatus: string): string {
  const s = processingStatus.toLowerCase();
  if (isInvalidWebhookRow(processingStatus)) {
    return "border-destructive/60 bg-destructive/15 text-destructive dark:bg-destructive/25";
  }
  if (s.includes("fail") || s.includes("error")) return "bg-destructive/15 text-destructive";
  if (s.includes("skip")) return "bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100";
  if (s.includes("queued") || s.includes("stored") || s.includes("duplicate") || s.includes("processed")) {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  return "bg-muted text-muted-foreground";
}

function CopyFieldButton({ value, label }: { value: string | null | undefined; label: string }) {
  const [copied, setCopied] = useState(false);
  const text = value?.trim();
  if (!text) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5"
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyTextToClipboard(text);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      <Copy className="size-3" aria-hidden />
      <span className="sr-only">{copied ? "Copied" : `Copy ${label}`}</span>
    </Button>
  );
}

function DetailSectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card/50 p-3", className)}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailFieldGrid({
  fields,
  copyKeys = [],
}: {
  fields: Record<string, WebhookDetailFieldValue>;
  copyKeys?: string[];
}) {
  return (
    <dl className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-2 gap-y-1.5 text-sm">
      {Object.entries(fields).map(([key, value]) => {
        const display = formatDetailFieldValue(value);
        const copyable = copyKeys.includes(key) && display !== "—";
        return (
          <div key={key} className="contents">
            <dt className="break-all text-xs text-muted-foreground">{key}</dt>
            <dd className="flex items-start gap-0.5 break-all font-mono text-xs">
              <span className="min-w-0 flex-1">{display}</span>
              {copyable ? <CopyFieldButton value={display} label={key} /> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function TopLineGrid({ topLine }: { topLine: WebhookRequestDetailDebug["topLine"] }) {
  const rows: Array<{ label: string; value: ReactNode; copy?: string | null }> = [
    { label: "request_id", value: topLine.request_id, copy: topLine.request_id },
    { label: "Time", value: formatTime(topLine.time) },
    { label: "Event", value: topLine.event ?? "—" },
    { label: "Lead", value: topLine.lead ?? "—" },
    { label: "Client", value: topLine.client ?? "—" },
    { label: "Subaccount", value: topLine.subaccount ?? "—" },
    { label: "Validity", value: validityBadge(topLine.validity) },
    {
      label: "Status",
      value: (
        <Badge variant="outline" className={`w-fit ${statusBadgeClass(topLine.status)}`}>
          {topLine.status}
        </Badge>
      ),
    },
    { label: "HTTP", value: httpBadge(topLine.http) },
    { label: "ms", value: topLine.ms ?? "—" },
    { label: "Route", value: topLine.route },
  ];

  return (
    <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="flex items-center gap-1 break-all text-sm">
            {row.value}
            {row.copy ? <CopyFieldButton value={row.copy} label={row.label} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ErrorDetailsCard({ errors }: { errors: NonNullable<WebhookRequestDetailDebug["errors"]> }) {
  return (
    <DetailSectionCard title="Error details" className="border-destructive/40 bg-destructive/5">
      <dl className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-2 gap-y-1.5 text-sm">
        <dt className="text-xs text-muted-foreground">error_code</dt>
        <dd className="font-mono text-xs">{formatDetailFieldValue(errors.error_code)}</dd>
        <dt className="text-xs text-muted-foreground">error_summary</dt>
        <dd className="break-all text-xs text-destructive">{formatDetailFieldValue(errors.error_summary)}</dd>
        <dt className="text-xs text-muted-foreground">processingStatus</dt>
        <dd className="font-mono text-xs">{errors.processingStatus}</dd>
        {errors.validityReason ? (
          <>
            <dt className="text-xs text-muted-foreground">validity reason</dt>
            <dd className="text-xs">{errors.validityReason}</dd>
          </>
        ) : null}
        {errors.unauthorizedReason ? (
          <>
            <dt className="text-xs text-muted-foreground">unauthorized</dt>
            <dd className="text-xs">{errors.unauthorizedReason}</dd>
          </>
        ) : null}
      </dl>
      {errors.fieldErrors.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-md border border-border bg-background/80 p-2 font-mono text-xs">
          {errors.fieldErrors.map((fe, i) => (
            <li key={`${fe.path}-${i}`}>
              <span className="text-muted-foreground">{fe.path}:</span> {fe.message}
            </li>
          ))}
        </ul>
      ) : null}
    </DetailSectionCard>
  );
}

function SummaryCard({ summary }: { summary: WebhookRequestDetailDebug["summary"] }) {
  return (
    <DetailSectionCard title="Status summary">
      <dl className="grid grid-cols-[minmax(100px,32%)_1fr] gap-x-2 gap-y-1.5 text-sm">
        <dt className="text-xs text-muted-foreground">Event</dt>
        <dd className="text-xs">{summary.event ?? "—"}</dd>
        <dt className="text-xs text-muted-foreground">Validity</dt>
        <dd>{validityBadge(summary.validity)}</dd>
        <dt className="text-xs text-muted-foreground">Status</dt>
        <dd>
          <Badge variant="outline" className={`w-fit ${statusBadgeClass(summary.status)}`}>
            {summary.status}
          </Badge>
        </dd>
        <dt className="text-xs text-muted-foreground">HTTP</dt>
        <dd>{httpBadge(summary.http)}</dd>
        <dt className="text-xs text-muted-foreground">Time</dt>
        <dd className="font-mono text-xs">{formatTime(summary.time)}</dd>
        <dt className="text-xs text-muted-foreground">Duration ms</dt>
        <dd className="font-mono text-xs tabular-nums">{summary.durationMs ?? "—"}</dd>
        <dt className="text-xs text-muted-foreground">Source</dt>
        <dd className="font-mono text-xs">{summary.source}</dd>
        <dt className="text-xs text-muted-foreground">Route</dt>
        <dd className="break-all font-mono text-xs">{summary.route}</dd>
      </dl>
    </DetailSectionCard>
  );
}

const RAW_JSON_TABS: Array<{ id: WebhookRawJsonTab; label: string }> = [
  { id: "request", label: "Request JSON" },
  { id: "response", label: "Response JSON" },
  { id: "meta", label: "Headers / Meta" },
];

function WebhookJsonCodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <div className="min-w-0 max-w-full space-y-1.5">
      <div className="flex items-center justify-end">
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleCopy}>
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <pre className="max-h-[420px] max-w-full overflow-x-auto overflow-y-auto whitespace-pre rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground">
        {text}
      </pre>
    </div>
  );
}

function WebhookRawJsonSection({ debug }: { debug: WebhookRequestDetailDebug }) {
  const [tab, setTab] = useState<WebhookRawJsonTab>("request");
  const payload = webhookRawJsonTabPayload(debug, tab);
  const text = stringifyWebhookJson(payload);

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div role="tablist" aria-label="Raw JSON" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {RAW_JSON_TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            variant={tab === item.id ? "secondary" : "ghost"}
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {text ? (
        <WebhookJsonCodeBlock text={text} />
      ) : (
        <p className="py-1 text-xs text-muted-foreground">{webhookRawJsonEmptyMessage(tab)}</p>
      )}
    </div>
  );
}

export function WebhookMonitorDetailDrawer({
  open,
  onOpenChange,
  selected,
  detail,
  detailLoading,
  detailError,
  onReload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: AdminWebhookListItem | null;
  detail: AdminWebhookDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onReload: () => void;
}) {
  const [compactCopied, setCompactCopied] = useState(false);

  const debug = detail?.debug;
  const topLine = debug?.topLine ?? (selected ? topLineFromListItem(selected) : null);

  const handleCompactCopy = useCallback(async () => {
    if (!selected) return;
    const ok = await copyTextToClipboard(buildCompactDebugSummary(selected, detail));
    if (ok) {
      setCompactCopied(true);
      window.setTimeout(() => setCompactCopied(false), 2000);
    }
  }, [selected, detail]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex h-full max-h-screen flex-col gap-0 overflow-hidden p-0",
          "w-screen max-w-[100vw]",
          "sm:w-[90vw] sm:max-w-[90vw]",
          "lg:w-[50vw] lg:min-w-[640px] lg:max-w-[960px]"
        )}
      >
        <SheetHeader className="sticky top-0 z-10 shrink-0 space-y-1 border-b border-border bg-background px-5 py-4 pr-14 text-left">
          <SheetTitle>Webhook request detail</SheetTitle>
          <SheetDescription className="text-left">
            Redacted request/response JSON and parsed lifecycle fields from{" "}
            <span className="font-mono">GET /admin/v1/coc/webhook-requests/:id</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-5 py-4 pb-12">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a row to inspect.</p>
          ) : (
            <div className="min-w-0 max-w-full space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled>
                  Copy cURL
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled>
                  Replay
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleCompactCopy}>
                  {compactCopied ? "Copied summary" : "Copy compact debug summary"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onReload} disabled={detailLoading}>
                  Reload
                </Button>
              </div>

              {topLine ? <TopLineGrid topLine={topLine} /> : null}

              {detailLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading detail payloads…
                </div>
              ) : null}

              {detailError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {detailError}
                </div>
              ) : null}

              {debug ? (
                <>
                  {debug.errors ? <ErrorDetailsCard errors={debug.errors} /> : null}
                  <SummaryCard summary={debug.summary} />
                  <DetailSectionCard title="Lead / Contact">
                    <DetailFieldGrid fields={debug.identity} copyKeys={["contact_id_ghl", "lead_uid"]} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Lifecycle event">
                    <DetailFieldGrid fields={debug.lifecycleEvent} copyKeys={["event_uuid"]} />
                  </DetailSectionCard>
                  <DetailSectionCard title="State snapshot">
                    <DetailFieldGrid fields={debug.state} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Attribution">
                    <DetailFieldGrid fields={debug.attribution} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Appointment">
                    <DetailFieldGrid fields={debug.appointment} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Policy">
                    <DetailFieldGrid fields={debug.policy} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Routing & ownership">
                    <DetailFieldGrid fields={debug.routingOwnership} />
                  </DetailSectionCard>
                  <DetailSectionCard title="Raw JSON">
                    <WebhookRawJsonSection debug={debug} />
                  </DetailSectionCard>
                </>
              ) : !detailLoading && !detailError ? (
                <p className="text-sm text-muted-foreground">
                  Summary above is from the list row. Detail payloads did not load.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
