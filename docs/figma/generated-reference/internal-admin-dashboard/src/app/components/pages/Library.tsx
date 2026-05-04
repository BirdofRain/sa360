import { Card, EmptyState, FeatureToggleRow, FilterBar, FilterInput, FilterSelect, JsonViewer, ResultChip, SeverityChip, StatCard, StatusChip, Toggle, WarningBanner } from "../primitives";
import { Inbox } from "lucide-react";

export function LibraryPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-slate-900">Component Library</h2>
        <p className="text-sm text-slate-500">Reusable building blocks for the SA360 C.O.S. admin surface. All layers named for developer handoff.</p>
      </div>

      <Section title="Stat Cards">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Webhooks today" value="12,481" delta="+8.2%" tone="good" />
          <StatCard label="Failed requests" value="34" delta="+9 vs avg" tone="bad" />
          <StatCard label="Match rate" value="78.4%" delta="-1.3%" tone="warn" />
          <StatCard label="Queue health" value="Healthy" tone="neutral" hint="p95 184ms" />
        </div>
      </Section>

      <Section title="Status Chips">
        <div className="flex flex-wrap gap-2">
          {["success", "failed", "queued", "retry", "active", "onboarding", "paused", "open", "ack", "resolved", "complete", "in_progress", "blocked"].map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Severity Chips">
        <div className="flex gap-2">
          <SeverityChip severity="critical" /><SeverityChip severity="high" /><SeverityChip severity="medium" /><SeverityChip severity="low" />
        </div>
      </Section>

      <Section title="Result Chips">
        <div className="flex flex-wrap gap-2">
          {["indexed", "known_caller", "appointment_logged", "attribution_upserted", "invalid_token", "downstream_timeout", "unknown_caller", "pending_admin"].map((v) => (
            <ResultChip key={v} value={v} />
          ))}
        </div>
      </Section>

      <Section title="Filter Bar">
        <FilterBar>
          <FilterInput placeholder="Search…" />
          <FilterSelect label="Source" options={["All", "GHL", "Synthflow", "Meta"]} />
          <FilterSelect label="Status" options={["All", "success", "failed"]} />
        </FilterBar>
      </Section>

      <Section title="Toggles & Feature Toggle Row">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3"><Toggle on={true} /><Toggle on={false} /></div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white">
            <FeatureToggleRow name="Voice (Synthflow)" description="Inbound voice lookup" on={true} />
            <FeatureToggleRow name="Meta Sync" description="CAPI server-side events" on={false} />
          </div>
        </div>
      </Section>

      <Section title="Banners">
        <div className="space-y-2">
          <WarningBanner tone="info" title="Info banner">Used for non-critical informational messages.</WarningBanner>
          <WarningBanner tone="warn" title="Warning banner">Something needs attention but isn't broken.</WarningBanner>
          <WarningBanner tone="err" title="Error banner">Hard failure — needs intervention.</WarningBanner>
        </div>
      </Section>

      <Section title="JSON Viewer">
        <JsonViewer data={{ event: "lead_created", contact: { id: "ctc_882", phone: "+13055550118" }, client_account_id: "cli_001" }} />
      </Section>

      <Section title="Empty State">
        <Card><EmptyState icon={Inbox} title="No webhooks match your filters" hint="Try broadening the date range or clearing the source filter." /></Card>
      </Section>

      <Section title="Review Item Card">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between"><SeverityChip severity="critical" /><StatusChip status="open" /></div>
            <div className="mt-2 text-sm text-slate-900" style={{ fontWeight: 500 }}>CAPI access token invalid</div>
            <div className="text-xs text-slate-500">Liberty Final Expense · loc_3xK29fA</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <section>
      <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">{title}</div>
      {children}
    </section>
  );
}
