import { WarningBanner } from "@/components/dashboard/warning-banner";

export function ActionCenterSetupWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <WarningBanner tone="info" title="Setup & data notes">
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </WarningBanner>
  );
}
