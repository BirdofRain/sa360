import { randomUUID } from "node:crypto";

import type { CompanySheetsClientFolder, PrismaClient } from "@prisma/client";
import {
  COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS,
  COMPANY_SHEETS_V3_COLUMNS,
  companySheetsTemplateNiche,
  companySheetsV3HeaderMatches,
} from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_GOOGLE_DRIVE_FILE_SCOPE,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_LEAD_HEADER_V2,
  companySheetsCampaignHeader,
  grantedScopeList,
  isCompanyGoogleSheetsEnabled,
  readCompanyStorageConfig,
} from "../../lib/company-google-sheets-env.js";
import {
  clientFolderClaimIsFresh,
  decideClientFolderAction,
  type ClientFolderMatch,
  type ClientFolderRecord,
} from "../../lib/company-sheets-client-folder-decision.js";
import { findClientForCompanySheets } from "../../repositories/company-sheets-destination.repository.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { getSpreadsheetMetadata } from "../google-sheets/google-sheets-http-client.js";
import { createCompanyDriveFile, findCompanyDriveNamedChild, getCompanyDriveFile, listCompanyDriveFolderChildren } from "./company-google-drive-http.js";
import { COMPANY_DRIVE_FOLDER_MIME, COMPANY_DRIVE_SPREADSHEET_MIME } from "./company-google-storage-policy.js";
import {
  establishControl,
  loadReadyConnection,
  verifyFolderForAddChild,
  type CompanySheetsDeps,
  type CompanySheetsFailure,
} from "./company-sheets-destination.service.js";

export type CompanySheetsFolderOutcome =
  | "reused"
  | "created"
  | "linked"
  | "select"
  | "in_progress"
  | "unknown";

type FolderBody = {
  folderId: string;
  title: string;
  url: string;
  source?: ClientFolderMatch["source"];
};

const SYNTHETIC_RECEIVED_AT = "2026-10-26T14:00:00.000Z";
const SYNTHETIC_SUBMITTED_AT = "2026-10-26T13:30:00.000Z";

function fail(code: CompanySheetsFailure["code"]): CompanySheetsFailure {
  return { ok: false, code, statusCode: statusFor(code), retryable: code === "retryable" };
}

function statusFor(code: CompanySheetsFailure["code"]): number {
  if (code === "destination_disabled" || code === "client_not_found" || code === "folder_unavailable") return 404;
  if (
    code === "invalid_folder" ||
    code === "invalid_folder_intent" ||
    code === "unsupported_schema" ||
    code === "invalid_worksheet" ||
    code === "invalid_spreadsheet_ref"
  ) {
    return 400;
  }
  if (code === "access_denied" || code === "drive_scope_required" || code === "drive_file_scope_required") return 403;
  if (code === "retryable" || code === "oauth_not_configured") return 503;
  if (
    code === "pause_delivery_first" ||
    code === "create_in_progress" ||
    code === "create_outcome_unknown" ||
    code === "recorded_folder_unavailable" ||
    code === "folder_not_in_parent" ||
    code === "ambiguous_client_folder" ||
    code === "google_not_connected" ||
    code === "google_reconnect_required" ||
    code === "approved_parent_unconfigured" ||
    code === "outside_approved_parent" ||
    code === "not_approved_parent"
  ) {
    return 409;
  }
  return 409;
}

function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function sheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}`;
}

function presentFolder(folderId: string, title: string, source?: ClientFolderMatch["source"]): FolderBody {
  return { folderId, title, url: folderUrl(folderId), ...(source ? { source } : {}) };
}

function sanitizeFolderTitle(displayName: string): string | null {
  const title = displayName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.length > 200) return null;
  return title;
}

function recordFrom(row: CompanySheetsClientFolder | null): ClientFolderRecord | null {
  if (!row) return null;
  if (row.status !== "active" && row.status !== "unlinked" && row.status !== "creating" && row.status !== "unknown") {
    return null;
  }
  return { folderId: row.folderId, folderTitle: row.folderTitle, status: row.status };
}

function hasScope(scopes: unknown, scope: string): boolean {
  return grantedScopeList(scopes).includes(scope);
}

export async function prepareCompanyClientFolder(
  clientAccountId: string,
  input: { intent: string; folderId?: string | null },
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      outcome: CompanySheetsFolderOutcome;
      created: boolean;
      linked: boolean;
      driveDeleted: false;
      folder: FolderBody | null;
      folders: FolderBody[];
    }
  | CompanySheetsFailure
> {
  if (input.intent !== "inspect" && input.intent !== "link" && input.intent !== "create") {
    return fail("invalid_folder_intent");
  }
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const folderTitle = sanitizeFolderTitle(client.clientDisplayName);
  if (!folderTitle) return fail("invalid_folder");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  if (!hasScope(ready.connection.scopes, "https://www.googleapis.com/auth/drive.metadata.readonly")) {
    return fail("drive_scope_required");
  }
  const config = readCompanyStorageConfig(env);
  if (!config.approvedSharedDriveId || !config.approvedParentFolderId) return fail("approved_parent_unconfigured");
  const parent = await verifyFolderForAddChild(config.approvedParentFolderId, ready, deps, env);
  if (!parent.ok) return parent;
  if (parent.file.id !== config.approvedParentFolderId || parent.file.driveId !== config.approvedSharedDriveId) {
    return fail("not_approved_parent");
  }
  const requested = input.folderId?.trim() || null;
  if (requested && requested === config.approvedParentFolderId) return fail("not_approved_parent");
  const stored = await db.companySheetsClientFolder.findUnique({ where: { clientAccountId: client.clientAccountId } });
  const recorded = recordFrom(stored);
  const now = deps.now?.() ?? new Date();
  let recordedFolderValid: boolean | null = null;
  if (recorded?.status === "active" && recorded.folderId) {
    recordedFolderValid = await folderStillUsable(recorded.folderId, config.approvedParentFolderId, ready, deps, env);
    if (input.intent === "create" && recordedFolderValid) {
      return {
        ok: true,
        outcome: "reused",
        created: false,
        linked: true,
        driveDeleted: false,
        folder: presentFolder(recorded.folderId, recorded.folderTitle || folderTitle, "recorded"),
        folders: [],
      };
    }
    if (input.intent === "create" && !recordedFolderValid) return fail("recorded_folder_unavailable");
  }
  const named = await listNameMatches(config.approvedParentFolderId, config.approvedSharedDriveId, folderTitle, ready.accessToken, deps);
  if (!named.ok) return named;
  let ancestryVerifiedFolderId: string | null = null;
  if (input.intent === "link" && requested) {
    const verified = await verifyFolderForAddChild(requested, ready, deps, env);
    if (!verified.ok) return verified;
    if (verified.file.driveId !== config.approvedSharedDriveId) return fail("outside_approved_parent");
    if (verified.file.id === config.approvedParentFolderId) return fail("not_approved_parent");
    ancestryVerifiedFolderId = verified.file.id;
  }
  const decision = decideClientFolderAction({
    intent: input.intent,
    requestedFolderId: requested,
    recorded,
    nameMatches: named.matches,
    claimHeldByOther: Boolean(
      stored?.status === "creating" &&
        stored.operationToken &&
        clientFolderClaimIsFresh(stored.updatedAt, now)
    ),
    recordedFolderValid,
    ancestryVerifiedFolderId,
    nameListTruncated: named.truncated,
  });
  if (decision.action === "reject") {
    if (decision.code === "ambiguous_client_folder") {
      return {
        ok: true,
        outcome: "select",
        created: false,
        linked: false,
        driveDeleted: false,
        folder: null,
        folders: (decision.folders ?? []).map((folder) => presentFolder(folder.folderId, folder.title, folder.source)),
      };
    }
    return fail(decision.code);
  }
  if (decision.action === "in_progress") {
    return emptyOutcome("in_progress");
  }
  if (decision.action === "unknown") return emptyOutcome("unknown");
  if (decision.action === "offer") {
    return {
      ok: true,
      outcome: "select",
      created: false,
      linked: false,
      driveDeleted: false,
      folder: null,
      folders: decision.folders.map((folder) => presentFolder(folder.folderId, folder.title, folder.source)),
    };
  }
  if (decision.action === "reuse") {
    return {
      ok: true,
      outcome: "reused",
      created: false,
      linked: true,
      driveDeleted: false,
      folder: presentFolder(decision.folderId, decision.title, "recorded"),
      folders: [],
    };
  }
  if (decision.action === "link") {
    const title = named.matches.find((match) => match.folderId === decision.folderId)?.title || recorded?.folderTitle || folderTitle;
    const linked = await activateFolder(db, client.clientAccountId, decision.folderId, title, now, "linked");
    if (!linked) return fail("create_in_progress");
    return {
      ok: true,
      outcome: "linked",
      created: false,
      linked: true,
      driveDeleted: false,
      folder: presentFolder(decision.folderId, title),
      folders: [],
    };
  }
  if (!hasScope(ready.connection.scopes, COMPANY_GOOGLE_DRIVE_FILE_SCOPE)) return fail("drive_file_scope_required");
  const claim = await claimFolderCreate(db, client.clientAccountId, now);
  if (!claim.ok) {
    if (claim.reason === "active" || claim.reason === "unlinked") {
      const current = await db.companySheetsClientFolder.findUnique({
        where: { clientAccountId: client.clientAccountId },
      });
      if (current?.folderId && current.status === "active") {
        return {
          ok: true,
          outcome: "reused",
          created: false,
          linked: true,
          driveDeleted: false,
          folder: presentFolder(current.folderId, current.folderTitle || folderTitle, "recorded"),
          folders: [],
        };
      }
      if (current?.folderId && current.status === "unlinked") {
        return {
          ok: true,
          outcome: "select",
          created: false,
          linked: false,
          driveDeleted: false,
          folder: null,
          folders: [presentFolder(current.folderId, current.folderTitle || folderTitle, "recorded")],
        };
      }
    }
    return emptyOutcome("in_progress");
  }
  const again = await listNameMatches(
    config.approvedParentFolderId,
    config.approvedSharedDriveId,
    folderTitle,
    ready.accessToken,
    deps
  );
  if (!again.ok) {
    await restoreClaim(db, client.clientAccountId, claim.token, stored);
    return again;
  }
  const afterClaim = decideClientFolderAction({
    intent: "create",
    recorded,
    nameMatches: again.matches,
    claimHeldByOther: false,
    recordedFolderValid,
    nameListTruncated: again.truncated,
  });
  if (afterClaim.action !== "create") {
    await restoreClaim(db, client.clientAccountId, claim.token, stored);
    if (afterClaim.action === "offer" || (afterClaim.action === "reject" && afterClaim.code === "ambiguous_client_folder")) {
      const folders = afterClaim.action === "offer" ? afterClaim.folders : (afterClaim.folders ?? []);
      return {
        ok: true,
        outcome: "select",
        created: false,
        linked: false,
        driveDeleted: false,
        folder: null,
        folders: folders.map((folder) => presentFolder(folder.folderId, folder.title, folder.source)),
      };
    }
    if (afterClaim.action === "unknown") return emptyOutcome("unknown");
    return fail("create_outcome_unknown");
  }
  const created = await (deps.createDriveFile ?? createCompanyDriveFile)(
    {
      name: folderTitle,
      mimeType: COMPANY_DRIVE_FOLDER_MIME,
      parentId: config.approvedParentFolderId,
      accessToken: ready.accessToken,
    },
    deps.fetchImpl
  );
  if (!created.ok) {
    if (created.reason === "network_error" || created.reason === "malformed_response" || created.reason === "server_error") {
      const recovered = await listNameMatches(
        config.approvedParentFolderId,
        config.approvedSharedDriveId,
        folderTitle,
        ready.accessToken,
        deps
      );
      if (recovered.ok && recovered.matches.length === 1 && !recovered.truncated) {
        const match = recovered.matches[0];
        if (!match) return fail("create_outcome_unknown");
        const linked = await finishClaim(db, client.clientAccountId, claim.token, match.folderId, match.title, now, "linked");
        return {
          ok: true,
          outcome: linked ? "created" : "select",
          created: false,
          linked,
          driveDeleted: false,
          folder: presentFolder(match.folderId, match.title, "name"),
          folders: linked ? [] : [presentFolder(match.folderId, match.title, "name")],
        };
      }
      await markUnknown(db, client.clientAccountId, claim.token);
      if (recovered.ok && recovered.matches.length > 1) {
        return {
          ok: true,
          outcome: "select",
          created: false,
          linked: false,
          driveDeleted: false,
          folder: null,
          folders: recovered.matches.map((folder) => presentFolder(folder.folderId, folder.title, "name")),
        };
      }
      return emptyOutcome("unknown");
    }
    await restoreClaim(db, client.clientAccountId, claim.token, stored);
    if (created.reason === "rate_limited") return fail("retryable");
    return fail("create_placement_failed");
  }
  if (!created.file.parents.includes(config.approvedParentFolderId) || created.file.name !== folderTitle) {
    await markUnknown(db, client.clientAccountId, claim.token);
    return emptyOutcome("unknown");
  }
  const usable = await folderStillUsable(created.file.id, config.approvedParentFolderId, ready, deps, env);
  if (!usable) {
    await markUnknown(db, client.clientAccountId, claim.token);
    return emptyOutcome("unknown");
  }
  const linked = await finishClaim(db, client.clientAccountId, claim.token, created.file.id, created.file.name, now, "created");
  return {
    ok: true,
    outcome: linked ? "created" : "select",
    created: true,
    linked,
    driveDeleted: false,
    folder: presentFolder(created.file.id, created.file.name),
    folders: linked ? [] : [presentFolder(created.file.id, created.file.name)],
  };
}

export async function unlinkCompanyClientFolder(
  clientAccountId: string,
  deps: CompanySheetsDeps = {}
): Promise<{ ok: true; unlinked: boolean; folderId: string | null; driveDeleted: false } | CompanySheetsFailure> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const row = await db.companySheetsClientFolder.findUnique({ where: { clientAccountId: client.clientAccountId } });
  if (!row?.folderId) return { ok: true, unlinked: false, folderId: null, driveDeleted: false };
  if (row.status !== "unlinked") {
    const now = deps.now?.() ?? new Date();
    await db.companySheetsClientFolder.update({
      where: { clientAccountId: client.clientAccountId },
      data: { status: "unlinked", unlinkedAt: now, operationToken: null },
    });
    await db.companySheetsFolderEvent.create({
      data: {
        clientAccountId: client.clientAccountId,
        folderId: row.folderId,
        folderTitle: row.folderTitle,
        action: "unlinked",
      },
    });
  }
  return { ok: true, unlinked: true, folderId: row.folderId, driveDeleted: false };
}

export async function listCompanyClientSpreadsheets(
  clientAccountId: string,
  pageToken: string | null,
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      folder: FolderBody | null;
      spreadsheets: Array<{ spreadsheetId: string; title: string; url: string }>;
      nextPageToken: string | null;
      skipped: number;
      links: Array<{
        spreadsheetId: string;
        spreadsheetTitle: string | null;
        spreadsheetUrl: string;
        status: string;
        recordedAt: string;
        supersededAt: string | null;
      }>;
      folderEvents: Array<{ folderId: string; folderTitle: string; action: string; createdAt: string }>;
      currentDestination: {
        spreadsheetId: string;
        spreadsheetTitle: string | null;
        spreadsheetUrl: string;
        updatedAt: string;
      } | null;
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const config = readCompanyStorageConfig(env);
  const row = await db.companySheetsClientFolder.findUnique({ where: { clientAccountId: client.clientAccountId } });
  const links = await db.companySheetsSpreadsheetLink.findMany({
    where: { clientAccountId: client.clientAccountId },
    orderBy: { recordedAt: "desc" },
    take: 20,
  });
  const events = await db.companySheetsFolderEvent.findMany({
    where: { clientAccountId: client.clientAccountId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: client.clientAccountId },
  });
  const history = {
    links: links.map((link) => ({
      spreadsheetId: link.spreadsheetId,
      spreadsheetTitle: link.spreadsheetTitle,
      spreadsheetUrl: link.spreadsheetUrl,
      status: link.status,
      recordedAt: link.recordedAt.toISOString(),
      supersededAt: link.supersededAt?.toISOString() ?? null,
    })),
    folderEvents: events.map((event) => ({
      folderId: event.folderId,
      folderTitle: event.folderTitle,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
    })),
    currentDestination: destination
      ? {
          spreadsheetId: destination.spreadsheetId,
          spreadsheetTitle: destination.spreadsheetTitle,
          spreadsheetUrl: destination.spreadsheetUrl,
          updatedAt: destination.updatedAt.toISOString(),
        }
      : null,
  };
  if (!row?.folderId || !config.approvedSharedDriveId) {
    return { ok: true, folder: null, spreadsheets: [], nextPageToken: null, skipped: 0, ...history };
  }
  const usable = await folderStillUsable(row.folderId, config.approvedParentFolderId, ready, deps, env);
  if (!usable) {
    return {
      ok: true,
      folder: presentFolder(row.folderId, row.folderTitle),
      spreadsheets: [],
      nextPageToken: null,
      skipped: 0,
      ...history,
    };
  }
  const listed = await listCompanyDriveFolderChildren(
    {
      parentId: row.folderId,
      mimeType: COMPANY_DRIVE_SPREADSHEET_MIME,
      driveId: config.approvedSharedDriveId,
      accessToken: ready.accessToken,
      pageToken,
    },
    deps.fetchImpl
  );
  if (!listed.ok) {
    if (listed.reason === "invalid_request") return fail("invalid_folder");
    if (listed.reason === "not_found" || listed.reason === "access_denied") {
      return { ok: true, folder: presentFolder(row.folderId, row.folderTitle), spreadsheets: [], nextPageToken: null, skipped: 1, ...history };
    }
    return fail(listed.reason === "rate_limited" || listed.reason === "network_error" || listed.reason === "server_error" ? "retryable" : "provider_error");
  }
  return {
    ok: true,
    folder: presentFolder(row.folderId, row.folderTitle),
    spreadsheets: listed.files.map((file) => ({
      spreadsheetId: file.id,
      title: file.name,
      url: sheetUrl(file.id),
    })),
    nextPageToken: listed.nextPageToken,
    skipped: listed.skipped,
    ...history,
  };
}

export async function probeCompanySheetWritePermission(
  clientAccountId: string,
  input: { spreadsheetId: string; worksheetId: number },
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      permissionProbe: true;
      canEdit: boolean | null;
      campaignDeliveryVerified: false;
      inventoryAffected: false;
      rowWritten: false;
      spreadsheetId: string;
      spreadsheetTitle: string;
      worksheetTitle: string;
      boundCampaignWorksheetId: number | null;
      matchesBoundCampaignTab: boolean;
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const ready = await loadReadyConnection({ ...deps, env, db });
  if (!ready.ok) return ready;
  const metadataResult = await (deps.getMetadata ?? getSpreadsheetMetadata)(
    { spreadsheetId: input.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  if (!metadataResult.ok) return fail("spreadsheet_unavailable");
  const worksheet = metadataResult.metadata.worksheets.find((sheet) => sheet.sheetId === input.worksheetId);
  if (!worksheet) return fail("worksheet_unavailable");
  const control = await establishControl(
    {
      connection: ready.connection,
      accessToken: ready.accessToken,
      spreadsheetId: input.spreadsheetId,
      metadata: metadataResult.metadata,
    },
    { ...deps, env, db }
  );
  if (!control.ok) return control;
  const drive = await (deps.getDriveFile ?? getCompanyDriveFile)(
    { fileId: input.spreadsheetId, accessToken: ready.accessToken },
    deps.fetchImpl
  );
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: client.clientAccountId },
    include: { tabContracts: true },
  });
  const campaign = destination?.tabContracts.find((tab) => tab.role === "campaign" && tab.setupState === "bound");
  const matchesBoundCampaignTab = Boolean(
    destination &&
      destination.spreadsheetId === input.spreadsheetId &&
      campaign?.worksheetId === input.worksheetId
  );
  return {
    ok: true,
    permissionProbe: true,
    canEdit: drive.ok ? drive.file.capabilities.canEdit : null,
    campaignDeliveryVerified: false,
      inventoryAffected: false,
      rowWritten: false,
      spreadsheetId: metadataResult.metadata.spreadsheetId,
    spreadsheetTitle: metadataResult.metadata.title,
    worksheetTitle: worksheet.title,
    boundCampaignWorksheetId: campaign?.worksheetId ?? null,
    matchesBoundCampaignTab,
  };
}

export async function reviewCompanySheetsColumnMapping(
  clientAccountId: string,
  input: { schemaVersion?: string | null; nicheKey?: string | null },
  deps: CompanySheetsDeps = {}
): Promise<
  | {
      ok: true;
      schemaVersion: string;
      niche: "vet" | "unsupported";
      timezone: "America/New_York";
      columns: Array<{
        header: string;
        sourceField: string;
        group: string;
        help: string;
        systemRequired: boolean;
        example: string;
        missingExample: string;
      }>;
      unmappedSampleLabels: readonly { label: string; reason: string }[];
      warnings: string[];
      readiness: string;
      spreadsheetId: string | null;
      worksheetId: number | null;
      boundSchemaVersion: string | null;
      customMapping: false;
    }
  | CompanySheetsFailure
> {
  const env = deps.env ?? process.env;
  if (!isCompanyGoogleSheetsEnabled(env)) return fail("destination_disabled");
  const db = deps.db ?? prisma;
  const client = await findClientForCompanySheets(clientAccountId, db);
  if (!client) return fail("client_not_found");
  const schemaVersion = input.schemaVersion?.trim() || COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3;
  const header = companySheetsCampaignHeader(schemaVersion);
  if (!header) return fail("unsupported_schema");
  const niche = companySheetsTemplateNiche(input.nicheKey);
  const populated = syntheticRow(schemaVersion, "populated");
  const missing = syntheticRow(schemaVersion, "missing");
  const columns =
    schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3
      ? COMPANY_SHEETS_V3_COLUMNS.map((column, index) => ({
          header: column.header,
          sourceField: column.sourceField,
          group: column.group,
          help: column.help,
          systemRequired: column.systemRequired,
          example: populated?.[index] ?? "",
          missingExample: missing?.[index] ?? "",
        }))
      : header.map((cell, index) => ({
          header: cell,
          sourceField: schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2 ? (COMPANY_SHEETS_LEAD_HEADER_V2[index] ?? cell) : cell,
          group: index < 7 ? "technical" : "enriched",
          help: "Existing machine header. A bound v1 or v2 tab is not rewritten.",
          systemRequired: cell === "delivery_row_id",
          example: populated?.[index] ?? "",
          missingExample: missing?.[index] ?? "",
        }));
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: client.clientAccountId },
    include: { tabContracts: true },
  });
  const campaign = destination?.tabContracts.find((tab) => tab.role === "campaign");
  const storedHeader = headerValues(campaign?.headerContract);
  const warnings = COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS.map((item) => `${item.label}: ${item.reason}`);
  if (schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
    warnings.push(
      "This is one shared campaign template. Selecting a niche does not change the columns. Veteran, nurse, trucker, and mortgage answers stay blank when they were not stored."
    );
    warnings.push(
      "Notes are written only from an unmapped source field whose key normalizes to notes. Appointment notes, disposition notes, and order notes are not read."
    );
  }
  if ((missing?.[0] ?? "") === "" && schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
    warnings.push("A missing source generation timestamp stays blank. Delivery time is not substituted.");
  }
  const expected = companySheetsCampaignHeader(schemaVersion);
  const headerMatches =
    Boolean(storedHeader && expected) &&
    (schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3
      ? companySheetsV3HeaderMatches(storedHeader)
      : expected!.every((cell, index) => storedHeader?.[index] === cell));
  let readiness = "tab_not_bound";
  if (!destination) readiness = "destination_not_saved";
  else if (campaign?.setupState !== "bound" || campaign.worksheetId == null) readiness = "tab_not_bound";
  else if (campaign.schemaVersion !== schemaVersion) readiness = "schema_not_bound";
  else if (!headerMatches) readiness = "incompatible_header";
  else readiness = "ready";
  if (readiness === "incompatible_header") warnings.push("The bound header does not match this template. Existing cells are not rewritten.");
  return {
    ok: true,
    schemaVersion,
    niche,
    timezone: "America/New_York",
    columns,
    unmappedSampleLabels: COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS,
    warnings,
    readiness,
    spreadsheetId: destination?.spreadsheetId ?? null,
    worksheetId: campaign?.worksheetId ?? null,
    boundSchemaVersion: campaign?.schemaVersion ?? null,
    customMapping: false,
  };
}

function syntheticRow(schemaVersion: string, mode: "populated" | "missing"): string[] | null {
  const populated = mode === "populated";
  return companySheetsCampaignRowValues({
    schemaVersion,
    stableRowId: "synthetic-preview-row",
    clientAccountId: "preview_client",
    sourceLeadEventId: "preview-event",
    receivedAt: SYNTHETIC_RECEIVED_AT,
    sourceLeadId: "preview-lead",
    normalizedPayload: populated
      ? {
          contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", state: "TX" },
          phone: "5550100",
          state: { lead_type: "VET" },
          lead_details: {
            consumer_age: "47",
            coverage_amount: "$50,000",
            date_of_birth: "1979-04-12",
            niche: { branch_of_service: "Army", disability_rating: "70%" },
          },
          routing: {
            source_intake: {
              lead_id: "preview-lead",
              submitted_at: SYNTHETIC_SUBMITTED_AT,
              sourceAttributes: {
                military_status: "Veteran",
                best_time_to_call: "Evening",
                marital_status: "Married",
                primary_reason: "Family",
                beneficiary: "Child",
                sex: "Female",
              },
              unmappedSourceFieldsJson: [
                { key: "time_to_completion_minutes", value: "12" },
                { key: "notes", value: "Preview note" },
              ],
            },
          },
        }
      : {
          contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", state: "TX" },
          phone: "5550100",
          routing: { source_intake: { submitted_at: "" } },
        },
  });
}

function headerValues(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((cell) => typeof cell === "string")) return null;
  return value;
}

function emptyOutcome(outcome: "in_progress" | "unknown") {
  return {
    ok: true as const,
    outcome,
    created: false,
    linked: false,
    driveDeleted: false as const,
    folder: null,
    folders: [],
  };
}

async function listNameMatches(
  parentId: string,
  driveId: string,
  name: string,
  accessToken: string,
  deps: CompanySheetsDeps
): Promise<{ ok: true; matches: Array<{ folderId: string; title: string }>; truncated: boolean } | CompanySheetsFailure> {
  const listed = await (deps.findNamedChild ?? findCompanyDriveNamedChild)(
    { parentId, name, mimeType: COMPANY_DRIVE_FOLDER_MIME, driveId, accessToken },
    deps.fetchImpl
  );
  if (!listed.ok) {
    if (listed.reason === "ambiguous") {
      return {
        ok: true,
        truncated: true,
        matches: (listed.files ?? []).map((file) => ({ folderId: file.id, title: file.name })),
      };
    }
    if (listed.reason === "access_denied") return fail("drive_scope_required");
    if (listed.reason === "rate_limited" || listed.reason === "network_error" || listed.reason === "server_error") {
      return fail("retryable");
    }
    return fail("folder_unavailable");
  }
  return { ok: true, truncated: false, matches: listed.files.map((file) => ({ folderId: file.id, title: file.name })) };
}

async function folderStillUsable(
  folderId: string,
  approvedParentId: string | null,
  ready: { connection: Parameters<typeof verifyFolderForAddChild>[1]["connection"]; accessToken: string },
  deps: CompanySheetsDeps,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (!approvedParentId || folderId === approvedParentId) return false;
  const verified = await verifyFolderForAddChild(folderId, ready, deps, env);
  return verified.ok && verified.file.id === folderId;
}

async function claimFolderCreate(
  db: PrismaClient,
  clientAccountId: string,
  now: Date
): Promise<{ ok: true; token: string } | { ok: false; reason: "in_progress" | "active" | "unlinked" }> {
  const token = randomUUID();
  const lockKey = `company-sheets-client-folder:${clientAccountId}`;
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const row = await tx.companySheetsClientFolder.findUnique({ where: { clientAccountId } });
    if (row?.status === "active" && row.folderId) return "active" as const;
    if (row?.status === "unlinked" && row.folderId) return "unlinked" as const;
    if (row?.status === "creating" && row.operationToken && clientFolderClaimIsFresh(row.updatedAt, now)) {
      return "in_progress" as const;
    }
    if (row) {
      await tx.companySheetsClientFolder.update({
        where: { clientAccountId },
        data: { status: "creating", operationToken: token },
      });
      return "claimed" as const;
    }
    try {
      await tx.companySheetsClientFolder.create({
        data: { clientAccountId, status: "creating", operationToken: token, folderTitle: "" },
      });
      return "claimed" as const;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return "in_progress" as const;
      throw err;
    }
  });
  if (outcome === "claimed") return { ok: true, token };
  if (outcome === "active" || outcome === "unlinked") return { ok: false, reason: outcome };
  return { ok: false, reason: "in_progress" };
}

async function finishClaim(
  db: PrismaClient,
  clientAccountId: string,
  token: string,
  folderId: string,
  folderTitle: string,
  now: Date,
  action: "created" | "linked"
): Promise<boolean> {
  const updated = await db.companySheetsClientFolder.updateMany({
    where: { clientAccountId, operationToken: token, status: "creating" },
    data: {
      status: "active",
      folderId,
      folderTitle,
      linkedAt: now,
      unlinkedAt: null,
      operationToken: null,
    },
  });
  if (updated.count !== 1) return false;
  await db.companySheetsFolderEvent.create({
    data: { clientAccountId, folderId, folderTitle, action },
  });
  return true;
}

async function activateFolder(
  db: PrismaClient,
  clientAccountId: string,
  folderId: string,
  folderTitle: string,
  now: Date,
  action: "linked"
): Promise<boolean> {
  await db.companySheetsClientFolder.upsert({
    where: { clientAccountId },
    create: {
      clientAccountId,
      folderId,
      folderTitle,
      status: "active",
      linkedAt: now,
      operationToken: null,
    },
    update: {
      folderId,
      folderTitle,
      status: "active",
      linkedAt: now,
      unlinkedAt: null,
      operationToken: null,
    },
  });
  await db.companySheetsFolderEvent.create({
    data: { clientAccountId, folderId, folderTitle, action },
  });
  return true;
}

async function markUnknown(db: PrismaClient, clientAccountId: string, token: string): Promise<void> {
  await db.companySheetsClientFolder.updateMany({
    where: { clientAccountId, operationToken: token, status: "creating" },
    data: { status: "unknown", operationToken: null },
  });
}

async function restoreClaim(
  db: PrismaClient,
  clientAccountId: string,
  token: string,
  previous: CompanySheetsClientFolder | null
): Promise<void> {
  if (!previous) {
    await db.companySheetsClientFolder.deleteMany({
      where: { clientAccountId, operationToken: token, status: "creating" },
    });
    return;
  }
  await db.companySheetsClientFolder.updateMany({
    where: { clientAccountId, operationToken: token, status: "creating" },
    data: {
      status: previous.status,
      operationToken: previous.operationToken,
      folderId: previous.folderId,
      folderTitle: previous.folderTitle,
      linkedAt: previous.linkedAt,
      unlinkedAt: previous.unlinkedAt,
    },
  });
}
