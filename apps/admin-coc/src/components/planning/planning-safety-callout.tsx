/**
 * Shared production-safety context for internal planning surfaces.
 * Stakeholder-facing copy only — not wired to delivery or routing logic.
 */
export function PlanningSafetyCallout() {
  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950"
      role="note"
    >
      <p className="font-semibold">Production safety posture</p>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[13px] leading-snug">
        <li>
          <span className="font-medium">GHL_DELIVERY_ADAPTER_MODE</span> stays disabled in
          production until an explicit cutover.
        </li>
        <li>Live canary delivery is manual only — no automatic lead_created → live delivery.</li>
        <li>Zapier / legacy delivery remains active until cutover is confirmed per client.</li>
        <li>
          First intended pilot: Breanna Kimberling — VET Final Expense (onboarding config only;
          not hardcoded in delivery source).
        </li>
        <li>Client portal is separate from this internal C.O.C.</li>
      </ul>
    </div>
  );
}
