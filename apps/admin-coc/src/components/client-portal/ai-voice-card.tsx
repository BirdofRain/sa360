import { Mic } from "lucide-react";

import { StatTile } from "@/components/dashboard/stat-tile";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalAiVoice } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";

export function AiVoiceCard({ aiVoice }: { aiVoice: ClientPortalAiVoice }) {
  if (!aiVoice.enabled) return null;

  return (
    <SectionPanel
      title="AI & voice activity"
      action={
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          <Mic className="size-3.5" aria-hidden />
          Voice assistant
        </span>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <StatTile label="Inbound calls" value={aiVoice.inboundCalls.toLocaleString()} />
        <StatTile
          label="AI appointments booked"
          value={aiVoice.aiAppointmentsBooked.toLocaleString()}
          tone={aiVoice.aiAppointmentsBooked > 0 ? "good" : "neutral"}
        />
        <StatTile
          label="Last voice activity"
          value={
            aiVoice.lastVoiceActivityAt
              ? formatRelativeTime(aiVoice.lastVoiceActivityAt)
              : "—"
          }
          hint="Recent AI or voice touchpoint"
        />
      </div>
    </SectionPanel>
  );
}
