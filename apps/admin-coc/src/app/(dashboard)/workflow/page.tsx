import { PlanningSafetyCallout } from "@/components/planning/planning-safety-callout";
import { WorkflowMap } from "@/components/planning/workflow/workflow-map";

/**
 * Internal reference surface — SA360 modular workflow map from Module 1
 * through Module 3 Voice. Pure static data; no API call.
 */
export default function WorkflowPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-900">
          SA360 Workflow Automation Map
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Module progression from intake and routing through GHL delivery, voice, client
          portal, and onboarding — with live canary explicitly disabled in production.
        </p>
      </header>
      <PlanningSafetyCallout />
      <WorkflowMap />
    </div>
  );
}
