import { ArchitectureMap } from "@/components/planning/architecture/architecture-map";

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
          Major system blocks and the primary data flows between them — designed to be
          presentation-ready for stakeholder reviews, not a comprehensive infra diagram.
        </p>
      </header>
      <ArchitectureMap />
    </div>
  );
}
