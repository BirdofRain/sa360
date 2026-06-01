import { ArchitectureMap } from "@/components/planning/architecture/architecture-map";
import { PlanningSafetyCallout } from "@/components/planning/planning-safety-callout";

/**
 * Internal reference surface — Smart Agent 360 system architecture.
 * Pure static data; no API call.
 */
export default function ArchitecturePage() {
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-900">
          Smart Agent 360 — System Architecture
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Phase 4I platform map — routing, shadow delivery, guarded GHL canary (disabled in
          prod), client portal beta, and onboarding priorities. Internal reference only.
        </p>
      </header>
      <PlanningSafetyCallout />
      <ArchitectureMap />
    </div>
  );
}
