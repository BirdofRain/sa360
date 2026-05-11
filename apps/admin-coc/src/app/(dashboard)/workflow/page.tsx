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
          Modular lead intake, routing, AI / voice orchestration, and execution flow — from
          a raw FB/GHL lead to a confirmed appointment with lifecycle sync.
        </p>
      </header>
      <WorkflowMap />
    </div>
  );
}
