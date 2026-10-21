import type { CompanyStorageConfig } from "../../lib/company-google-sheets-env.js";
import {
  companyAccountOwnsDriveFile,
  type CompanyDriveFile,
  type CompanyDriveHttpFailure,
} from "./company-google-drive-http.js";

export const COMPANY_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const COMPANY_DRIVE_SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const COMPANY_STORAGE_ANCESTRY_LIMIT = 20;

export type CompanyStorageOperation = "edit" | "add_child";

export type CompanyStorageFailureReason =
  | "not_company_controlled"
  | "approved_drive_unconfigured"
  | "approved_parent_unconfigured"
  | "unapproved_shared_drive"
  | "outside_approved_parent"
  | "insufficient_capability"
  | "ancestry_unavailable"
  | "ancestry_cycle";

export type CompanyStorageBasis = "my_drive_owner" | "approved_shared_drive";

export type CompanyStorageDecision =
  | { ok: true; basis: CompanyStorageBasis }
  | { ok: false; reason: CompanyStorageFailureReason | CompanyDriveHttpFailure };

type AncestorLoad =
  | { ok: true; file: CompanyDriveFile }
  | { ok: false; reason: CompanyDriveHttpFailure };

/**
 * Location is ownership for My Drive, or the configured drive plus ancestry
 * for a shared drive. A successful read, a true capability, or any driveId
 * is not approval by itself.
 */
export function evaluateCompanyStorageFile(input: {
  file: CompanyDriveFile;
  ancestorFolderIds: readonly string[];
  config: CompanyStorageConfig;
  companyEmail: string | null;
  operation: CompanyStorageOperation;
}): CompanyStorageDecision {
  const location = locateCompanyStorageFile(input);
  if (!location.ok) return location;
  if (!operationCapabilityAllows(input.file, input.operation)) {
    return { ok: false, reason: "insufficient_capability" };
  }
  return location;
}

export function locateCompanyStorageFile(input: {
  file: CompanyDriveFile;
  ancestorFolderIds: readonly string[];
  config: CompanyStorageConfig;
  companyEmail: string | null;
}): CompanyStorageDecision {
  const { file, config, companyEmail } = input;
  if (!file.driveId) {
    if (!companyAccountOwnsDriveFile(file, companyEmail)) {
      return { ok: false, reason: "not_company_controlled" };
    }
    return { ok: true, basis: "my_drive_owner" };
  }
  if (!config.approvedSharedDriveId) return { ok: false, reason: "approved_drive_unconfigured" };
  if (file.driveId !== config.approvedSharedDriveId) return { ok: false, reason: "unapproved_shared_drive" };
  if (!config.approvedParentFolderId) return { ok: false, reason: "approved_parent_unconfigured" };
  const underParent =
    file.id === config.approvedParentFolderId || input.ancestorFolderIds.includes(config.approvedParentFolderId);
  if (!underParent) return { ok: false, reason: "outside_approved_parent" };
  return { ok: true, basis: "approved_shared_drive" };
}

export function operationCapabilityAllows(file: CompanyDriveFile, operation: CompanyStorageOperation): boolean {
  if (operation === "edit") return file.capabilities.canEdit === true;
  return file.capabilities.canAddChildren === true;
}

/**
 * Walk parents until the approved folder. Every visited folder must stay in
 * the approved drive. The approved folder itself has no ancestors to collect.
 */
export async function collectSharedDriveAncestors(
  file: CompanyDriveFile,
  approvedDriveId: string,
  approvedParentFolderId: string,
  load: (fileId: string) => Promise<AncestorLoad>
): Promise<{ ok: true; ancestorFolderIds: string[] } | { ok: false; reason: CompanyStorageFailureReason | CompanyDriveHttpFailure }> {
  if (file.id === approvedParentFolderId) return { ok: true, ancestorFolderIds: [] };
  const ancestorFolderIds: string[] = [];
  const seen = new Set<string>([file.id]);
  let frontier = [...file.parents];
  let loadedCount = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parentId of frontier) {
      if (seen.has(parentId)) return { ok: false, reason: "ancestry_cycle" };
      seen.add(parentId);
      loadedCount += 1;
      if (loadedCount > COMPANY_STORAGE_ANCESTRY_LIMIT) return { ok: false, reason: "ancestry_cycle" };
      const loaded = await load(parentId);
      if (!loaded.ok) {
        if (loaded.reason === "not_found" || loaded.reason === "access_denied") {
          return { ok: false, reason: "ancestry_unavailable" };
        }
        return { ok: false, reason: loaded.reason };
      }
      if (loaded.file.driveId !== approvedDriveId) return { ok: false, reason: "unapproved_shared_drive" };
      ancestorFolderIds.push(loaded.file.id);
      if (loaded.file.id === approvedParentFolderId) return { ok: true, ancestorFolderIds };
      for (const grandparentId of loaded.file.parents) next.push(grandparentId);
    }
    frontier = next;
  }
  return { ok: false, reason: "outside_approved_parent" };
}
