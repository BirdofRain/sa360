import { PlanningSafetyCallout } from "@/components/planning/planning-safety-callout";
import { PivotArchiveView } from "@/components/planning/archive/pivot-archive-view";

/**
 * Read-only historical planning snapshot for pre Lead Fulfillment OS direction.
 * Comparison only — does not alter current roadmap modules.
 */
export default function PivotArchivePage() {
  return (
    <div className="space-y-4">
      <PlanningSafetyCallout />
      <PivotArchiveView />
    </div>
  );
}
