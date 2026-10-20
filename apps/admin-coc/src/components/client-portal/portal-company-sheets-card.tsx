import type {
  PortalCompanySheetsDestination,
  PortalOrderSheetsEvidence,
} from "@/lib/client-portal-api/company-sheets";

export type { PortalOrderSheetsEvidence };

export function PortalCompanySheetsCard({
  destination,
  error,
  context,
  orderEvidence = null,
}: {
  destination: PortalCompanySheetsDestination | null;
  error?: string | null;
  context: "account" | "order";
  orderEvidence?: readonly PortalOrderSheetsEvidence[] | null;
}) {
  if (context === "order") {
    const evidence = orderEvidence ?? [];
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Google Sheets</h2>
        {error ? (
          <p className="mt-2 text-sm text-slate-600" role="alert">
            {error}
          </p>
        ) : evidence.length > 0 ? (
          <div className="mt-2 space-y-3 text-sm text-slate-700">
            <ul className="space-y-2">
              {evidence.map((item) => (
                <li key={item.exportPackageId}>
                  <a className="font-medium text-sky-800 underline" href={item.spreadsheetUrl}>
                    Spreadsheet for this order
                  </a>
                  <span className="text-slate-500"> / {item.worksheetTitle}</span>
                  <span className="mt-1 block">Automated Sheets status: {item.status}.</span>
                </li>
              ))}
            </ul>
            <p>CSV download is unchanged. Opening this link does not grant Google access.</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-700">
              No automated Google Sheets delivery has been recorded for this order.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              CSV download is unchanged. This page does not use the account&apos;s current spreadsheet as
              this order&apos;s link.
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Google Sheets</h2>
      {error ? (
        <p className="mt-2 text-sm text-slate-600" role="alert">
          {error}
        </p>
      ) : destination ? (
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p>
            <a className="font-medium text-sky-800 underline" href={destination.spreadsheetUrl}>
              {destination.spreadsheetTitle ?? "Your spreadsheet"}
            </a>
            <span className="text-slate-500"> / {destination.worksheetTitle}</span>
          </p>
          <p>Read access: {destination.accessStatus}.</p>
          <p>Delivery: not started. New leads are not written to this spreadsheet yet.</p>
          <p>
            Opening this link does not give your Google account access to the file.
            {destination.sharing.missingRecipientPolicy
              ? " Your team has not recorded a Google recipient yet."
              : " A Google recipient is recorded, and permission has not been granted."}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          No company spreadsheet is configured for your account yet.
        </p>
      )}
    </section>
  );
}
