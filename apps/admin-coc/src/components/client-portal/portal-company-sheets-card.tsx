import type { PortalCompanySheetsDestination } from "@/lib/client-portal-api/company-sheets";

export function PortalCompanySheetsCard({
  destination,
  error,
  context,
}: {
  destination: PortalCompanySheetsDestination | null;
  error?: string | null;
  context: "account" | "order";
}) {
  if (context === "order") {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Google Sheets</h2>
        <p className="mt-2 text-sm text-slate-700">
          No automated Google Sheets delivery has been recorded for this order.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          CSV download is unchanged. This page does not use the account&apos;s current spreadsheet as
          this order&apos;s link.
        </p>
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
          {context === "order" ? " This order is not delivered to Google Sheets." : ""}
        </p>
      )}
    </section>
  );
}
