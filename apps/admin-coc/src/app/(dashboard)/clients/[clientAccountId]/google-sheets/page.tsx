import Link from "next/link";

import { CompanySheetsAdminPanel } from "@/components/clients/company-sheets-admin-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  activateCompanySheetsDispatchAction,
  bindCompanySheetsTabAction,
  clearCompanyGoogleFolderAction,
  createCompanySheetsTabAction,
  createCompanySpreadsheetAction,
  listCompanyClientSpreadsheetsAction,
  prepareCompanyClientFolderAction,
  sendCompanySheetsCampaignTestAction,
  probeCompanySheetWriteAction,
  resolveCompanyClientFolderAction,
  deleteCompanySheetsDestinationAction,
  inspectCompanySheetsTabsAction,
  disconnectCompanyGoogleAction,
  resolveCompanySpreadsheetAction,
  reviewCompanySheetsColumnsAction,
  saveCompanyGoogleFolderAction,
  saveCompanySheetsDestinationAction,
  startCompanyGoogleOAuthAction,
  testCompanySpreadsheetAction,
  unlinkCompanyClientFolderAction,
} from "@/app/actions/company-google-sheets";
import {
  createOnboardingColumnMapAction,
  previewOnboardingColumnMapAction,
  saveAndPublishOnboardingColumnMapAction,
  saveOnboardingSheetsTargetAction,
} from "@/app/actions/client-onboarding-v2";
import {
  fetchCompanyGoogleConnection,
  fetchCompanySheetsDestination,
  fetchCompanySheetsDispatch,
  listCompanyClientSpreadsheets,
} from "@/lib/admin-api/company-google-sheets";
import { listOnboardingColumnMaps } from "@/lib/admin-api/client-onboarding-v2";
import type { ColumnMapRecord } from "@/lib/clients/onboarding/types";
import { fetchAdminClientDetail, isAdminApiConfigured } from "@/lib/admin-api/server";

export default async function ClientCompanyGoogleSheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientAccountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientAccountId } = await params;
  const id = decodeURIComponent(clientAccountId);
  const query = await searchParams;
  const companyGoogle = Array.isArray(query.companyGoogle) ? query.companyGoogle[0] : query.companyGoogle;
  const notice =
    companyGoogle === "connected"
      ? "Company Google account connected. Delivery is still disabled."
      : companyGoogle === "cancelled"
        ? "Google connection was cancelled."
        : companyGoogle === "account_in_use"
          ? "That Google account is already connected to a client or a different company identity."
          : companyGoogle === "error"
            ? "Google connection did not complete."
            : null;

  if (!isAdminApiConfigured()) {
    return (
      <WarningBanner tone="warn" title="Admin API not configured">
        Set the admin API base URL and key to manage company Google Sheets destinations.
      </WarningBanner>
    );
  }

  const [connectionResult, destinationResult, detailResult, dispatchResult, folderResult] = await Promise.all([
    fetchCompanyGoogleConnection(),
    fetchCompanySheetsDestination(id),
    fetchAdminClientDetail(id),
    fetchCompanySheetsDispatch(id),
    listCompanyClientSpreadsheets(id),
  ]);
  const mapsResult = await listOnboardingColumnMaps(id);
  const displayName = detailResult.data?.item.clientDisplayName?.trim() || id;
  const nicheKey = detailResult.data?.item.primaryNicheKeys?.find((key) => key.trim()) ?? null;
  const loadError = !connectionResult.ok
    ? connectionResult.body
    : !destinationResult.ok
      ? destinationResult.body
      : null;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/clients/${encodeURIComponent(id)}`} className="text-xs text-sky-700 hover:underline">
          ← Client profile
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Company Google Sheets</h1>
        <p className="font-mono text-sm text-muted-foreground">{id}</p>
      </div>
      {loadError || !connectionResult.ok || !destinationResult.ok ? (
        <WarningBanner tone="warn" title="Could not load Google Sheets setup">
          {loadError ?? "Could not load Google Sheets setup."}
        </WarningBanner>
      ) : (
        <CompanySheetsAdminPanel
          clientAccountId={id}
          clientDisplayName={displayName}
          nicheKey={nicheKey}
          connection={connectionResult.data.connection}
          destination={destinationResult.data.destination}
          dispatch={dispatchResult.ok ? dispatchResult.data : null}
          notice={notice}
          actions={{
            startOAuth: startCompanyGoogleOAuthAction,
            disconnect: disconnectCompanyGoogleAction,
            saveFolder: saveCompanyGoogleFolderAction,
            clearFolder: clearCompanyGoogleFolderAction,
            resolve: resolveCompanySpreadsheetAction,
            resolveClientFolder: resolveCompanyClientFolderAction,
            prepareClientFolder: prepareCompanyClientFolderAction,
            unlinkClientFolder: unlinkCompanyClientFolderAction,
            listFolderSpreadsheets: listCompanyClientSpreadsheetsAction,
            create: createCompanySpreadsheetAction,
            testAccess: testCompanySpreadsheetAction,
            probeWrite: probeCompanySheetWriteAction,
            sendCampaignTest: sendCompanySheetsCampaignTestAction,
            saveDestination: saveCompanySheetsDestinationAction,
            removeDestination: deleteCompanySheetsDestinationAction,
            inspectTabs: inspectCompanySheetsTabsAction,
            reviewColumns: reviewCompanySheetsColumnsAction,
            bindTab: bindCompanySheetsTabAction,
            createTab: createCompanySheetsTabAction,
            setDispatch: activateCompanySheetsDispatchAction,
            saveSheetsTarget: saveOnboardingSheetsTargetAction,
            createColumnMap: createOnboardingColumnMapAction,
            saveAndPublishColumnMap: saveAndPublishOnboardingColumnMapAction,
            previewColumnMap: previewOnboardingColumnMapAction,
          }}
          initialColumnMap={pickColumnMap(
            mapsResult.ok ? mapsResult.data : [],
            destinationResult.data.destination?.spreadsheetId ?? null,
            destinationResult.data.destination?.worksheetId ?? null
          )}
          initialFolderList={folderResult.ok ? folderResult.data : undefined}
          folderLoadError={folderResult.ok ? null : "Saved folder could not be loaded."}
        />
      )}
    </div>
  );
}

function pickColumnMap(maps: ColumnMapRecord[], spreadsheetId: string | null, worksheetId: number | null): ColumnMapRecord | null {
  const active = maps.filter((map) => map.status === "draft" || map.status === "published");
  const matched =
    spreadsheetId && worksheetId != null
      ? active.filter((map) => map.spreadsheetId === spreadsheetId && map.worksheetId === worksheetId)
      : active;
  return matched.find((map) => map.status === "draft") ?? matched.find((map) => map.status === "published") ?? null;
}
