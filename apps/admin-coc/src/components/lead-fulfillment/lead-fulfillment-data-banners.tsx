import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { LeadFulfillmentOverviewData } from "@/lib/lead-fulfillment/types";
import { hasLimitedLf1ModuleKpis } from "@/lib/lead-fulfillment/lead-fulfillment-adapters";

export function LeadFulfillmentDataBanners({
  dataSource,
  data,
  loadError,
  dataLimitations,
}: {
  dataSource: "live" | "mock";
  data: LeadFulfillmentOverviewData;
  loadError: string | null;
  dataLimitations: string[];
}) {
  const showLimitedLf1 =
    dataSource === "live" &&
    (hasLimitedLf1ModuleKpis(data) || dataLimitations.length > 0);

  return (
    <>
      {dataSource === "live" ? (
        <WarningBanner tone="info" title="Live proof vault data">
          KPIs, proof summary, intake rows, and activity are loaded from the LF1 proof
          vault. Proof packet and verification status reflect stored intake records.
        </WarningBanner>
      ) : (
        <WarningBanner tone="warn" title="Demo data fallback">
          {loadError
            ? `Could not load live proof vault overview (${loadError}). Showing static mock data.`
            : "Admin API is unavailable. Showing static mock data until live proof vault wiring is configured."}
        </WarningBanner>
      )}

      {showLimitedLf1 ? (
        <WarningBanner tone="info" title="Limited LF1 data">
          <ul className="mt-1 list-inside list-disc">
            {(dataLimitations.length > 0
              ? dataLimitations
              : [
                  "Inventory, order, and delivery KPIs remain placeholders until LF3–LF5 modules are implemented.",
                ]
            )
              .slice(0, 3)
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
          </ul>
        </WarningBanner>
      ) : null}
    </>
  );
}
