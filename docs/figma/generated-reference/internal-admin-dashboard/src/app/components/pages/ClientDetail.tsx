import { useState } from "react";
import { Card, FeatureToggleRow, JsonViewer, ResultChip, StatusChip, WarningBanner } from "../primitives";
import { reviewItems, timeline, webhooks } from "../data";

const TABS = ["Overview", "GHL Link", "Feature Flags", "Voice/Synthflow", "Meta/CAPI", "Recent Events", "Review Items", "Settings"] as const;

export function ClientDetail() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  return (
    <div className="space-y-4 p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-slate-900">Liberty Final Expense</h2>
              <StatusChip status="active" />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Final Expense</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>client_account_id <code className="rounded bg-slate-100 px-1">cli_001</code></span>
              <span>subaccount_id_ghl <code className="rounded bg-slate-100 px-1">loc_3xK29fA</code></span>
              <span>onboarded 2025-11-04</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Pause client</button>
            <button className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800">Open in GHL</button>
          </div>
        </div>
        <div className="mt-4 flex gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm transition ${tab === t ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>{t}</button>
          ))}
        </div>
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "GHL Link" && <GHLTab />}
      {tab === "Feature Flags" && <FlagsTab />}
      {tab === "Voice/Synthflow" && <VoiceTab />}
      {tab === "Meta/CAPI" && <MetaTab />}
      {tab === "Recent Events" && <EventsTab />}
      {tab === "Review Items" && <ReviewTab />}
      {tab === "Settings" && <SettingsTab />}
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 space-y-4">
        <WarningBanner tone="err" title="Meta CAPI access token invalid" action={<button className="rounded-md bg-white px-2.5 py-1 text-xs text-red-900 ring-1 ring-red-300">Reconnect</button>}>
          Reconnect required — 3 events skipped in last 60 minutes.
        </WarningBanner>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Webhooks today" value="3,418" />
          <Stat label="Synthflow today" value="142" />
          <Stat label="Known caller rate" value="81%" />
          <Stat label="Open reviews" value="3" />
        </div>
        <Card title="Recent webhooks">
          <div className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {webhooks.slice(0, 5).map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-2.5 text-slate-500">{w.ts}</td>
                    <td className="px-4 py-2.5"><code className="text-[12px]">{w.event}</code></td>
                    <td className="px-4 py-2.5"><StatusChip status={w.status} /></td>
                    <td className="px-4 py-2.5"><ResultChip value={w.result} /></td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{w.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title="Account summary">
        <dl className="divide-y divide-slate-100 text-sm">
          {[
            ["Plan", "Performance OS · Tier 2"],
            ["Lead types", "Final Expense"],
            ["Primary owner", "Devon M."],
            ["Beta features", "voice_v2, attribution_v3"],
            ["Region", "us-east-1"],
            ["Webhook secret", "rotated 4d ago"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">{k}</span>
              <span className="text-slate-800">{v}</span>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function GHLTab() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="GHL connection">
        <div className="space-y-3 p-4 text-sm">
          <Row k="Location ID" v="loc_3xK29fA" mono />
          <Row k="OAuth status" v={<StatusChip status="active" />} />
          <Row k="Scopes" v="contacts.* opportunities.* calendars.read users.read" />
          <Row k="Token refreshed" v="2026-04-30 09:14 UTC" />
          <Row k="Last sync" v="30s ago" />
          <Row k="Webhook URL" v="https://hooks.sa360.io/ghl/cli_001" mono />
        </div>
      </Card>
      <Card title="Lifecycle webhook events subscribed">
        <ul className="divide-y divide-slate-100 text-sm">
          {["ContactCreate", "ContactUpdate", "OpportunityCreate", "OpportunityStatusUpdate", "AppointmentCreate", "InboundMessage"].map((e) => (
            <li key={e} className="flex items-center justify-between px-4 py-2.5">
              <code className="text-[12px]">{e}</code>
              <StatusChip status="success" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FlagsTab() {
  return (
    <Card title="Feature flags">
      <FeatureToggleRow name="Voice (Synthflow)" description="Inbound voice lookup + agent routing" on={true} />
      <FeatureToggleRow name="Blue" description="Outbound automation engine — long-form nurturing" on={true} />
      <FeatureToggleRow name="Green" description="First-response SLA + speed-to-lead automation" on={true} />
      <FeatureToggleRow name="CloseBot" description="AI follow-up assistant for sales conversations" on={true} />
      <FeatureToggleRow name="GHL AI" description="Native GHL conversational AI integration" on={false} />
      <FeatureToggleRow name="Meta Sync (CAPI)" description="Server-side conversion events to Meta" on={true} />
      <FeatureToggleRow name="Cross-subaccount lookup" description="Allow Synthflow to match across subaccounts" on={false} />
      <FeatureToggleRow name="Replay enabled" description="Enable webhook replay from admin tools" on={true} />
    </Card>
  );
}

function VoiceTab() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Synthflow configuration">
        <div className="space-y-3 p-4 text-sm">
          <Row k="Default agent" v="Liberty_Inbound_Agent" />
          <Row k="Model ID" v="gpt-4o-mini" mono />
          <Row k="Override model" v="—" />
          <Row k="Lookup endpoint" v="hooks.sa360.io/synthflow/cli_001" mono />
          <Row k="Inbound numbers" v="+1 855 555 1020, +1 833 555 0810" />
        </div>
      </Card>
      <Card title="Response variables template">
        <div className="p-3"><JsonViewer data={{ known_caller: "{{contact.exists}}", lead_type: "{{contact.tags.lead_type}}", stage: "{{contact.pipeline_stage}}", last_touch: "{{contact.last_touch_source}}" }} /></div>
      </Card>
    </div>
  );
}

function MetaTab() {
  return (
    <Card title="Meta / CAPI">
      <div className="space-y-3 p-4 text-sm">
        <WarningBanner tone="err" title="Access token returned 190 OAuthException">Token expired or revoked. Reconnect via Meta Business Manager.</WarningBanner>
        <Row k="Pixel ID" v="1083920481" mono />
        <Row k="Dataset ID" v="ds_77182" mono />
        <Row k="Test event code" v="TEST64829" mono />
        <Row k="Sent / Skipped / Failed (24h)" v="412 · 14 · 3" />
      </div>
    </Card>
  );
}

function EventsTab() {
  return (
    <Card title="Recent events">
      <ol className="space-y-0">
        {timeline.slice(0, 6).map((e, i) => (
          <li key={e.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
            <span className="mt-1 text-[11px] text-slate-400">{e.ts}</span>
            <div className="flex-1">
              <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{e.title}</div>
              <div className="text-xs text-slate-500">{e.detail}</div>
            </div>
            <span className="text-[11px] text-slate-400">#{i + 1}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ReviewTab() {
  return (
    <Card title="Review items for this client">
      <ul className="divide-y divide-slate-100">
        {reviewItems.filter((r) => r.client === "Liberty Final Expense").map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm text-slate-900">{r.reason}</div>
              <div className="text-xs text-slate-500">workflow {r.workflow} · {r.ts}</div>
            </div>
            <StatusChip status={r.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SettingsTab() {
  return (
    <Card title="Client settings">
      <div className="space-y-3 p-4 text-sm">
        <Row k="Display name" v="Liberty Final Expense" />
        <Row k="Internal slug" v="liberty-fe" mono />
        <Row k="Webhook secret" v="whsec_•••••••••••• 4f9c" mono />
        <Row k="Created" v="2025-11-04 by Devon M." />
        <Row k="Danger zone" v={<button className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100">Pause client</button>} />
      </div>
    </Card>
  );
}

function Row({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{k}</span>
      <span className={`text-slate-800 ${mono ? "font-mono text-[12px]" : ""}`}>{v}</span>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="text-[22px] text-slate-900" style={{ fontWeight: 500 }}>{value}</div></div>;
}
