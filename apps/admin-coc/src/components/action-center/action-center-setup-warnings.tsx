import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { CollectionAvailability } from "@/lib/action-center/defensive-payload";

export function ActionCenterSetupWarnings({
  warnings,
  availability = "ok",
}: {
  warnings?: string[] | null;
  availability?: CollectionAvailability;
}) {
  if (availability === "unavailable") {
    return (
      <WarningBanner tone="warn" title="Setup notes unavailable">
        The API omitted setup warnings. This is not the same as having no notes.
      </WarningBanner>
    );
  }

  const items = Array.isArray(warnings) ? warnings : [];
  if (items.length === 0) return null;

  return (
    <WarningBanner tone="info" title="Setup & data notes">
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </WarningBanner>
  );
}
