import { StatTile } from "@/components/dashboard/stat-tile";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalFunnel } from "@/lib/client-portal/types";

const STEPS: {
  key: keyof Pick<
    ClientPortalFunnel,
    "leadsReceived" | "replied" | "appointmentsSet" | "appointmentsShowed" | "sold"
  >;
  label: string;
}[] = [
  { key: "leadsReceived", label: "Leads received" },
  { key: "replied", label: "Replied" },
  { key: "appointmentsSet", label: "Appointments set" },
  { key: "appointmentsShowed", label: "Showed" },
  { key: "sold", label: "Sold" },
];

export function LeadFunnelCard({ funnel }: { funnel: ClientPortalFunnel }) {
  return (
    <SectionPanel title="Lead funnel">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step) => (
          <StatTile
            key={step.key}
            label={step.label}
            value={funnel[step.key].toLocaleString()}
            tone={step.key === "sold" && funnel.sold > 0 ? "good" : "neutral"}
          />
        ))}
      </div>
    </SectionPanel>
  );
}
