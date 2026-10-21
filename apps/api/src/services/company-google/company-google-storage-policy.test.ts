import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyDriveFile } from "./company-google-drive-http.js";
import {
  collectSharedDriveAncestors,
  evaluateCompanyStorageFile,
} from "./company-google-storage-policy.js";

const DRIVE = "0AApprovedDrive00";
const PARENT = "1ApprovedParentFolder";
const CHILD = "1ClientSubfolder0001";
const SHEET = "1spreadsheet00000001";

const config = { approvedSharedDriveId: DRIVE, approvedParentFolderId: PARENT };

function file(overrides: Partial<CompanyDriveFile> & Pick<CompanyDriveFile, "id" | "mimeType">): CompanyDriveFile {
  return {
    name: "File",
    ownedByMe: false,
    ownerEmails: [],
    driveId: null,
    parents: [],
    capabilities: { canEdit: true, canAddChildren: null },
    trashed: false,
    shortcutTargetId: null,
    ...overrides,
  };
}

test("My Drive ownership still authorizes an editable file", () => {
  const decision = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ownedByMe: true,
      ownerEmails: ["sheets@lifeagentlaunch.com"],
    }),
    ancestorFolderIds: [],
    config,
    companyEmail: "sheets@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(decision, { ok: true, basis: "my_drive_owner" });
});

test("a readable My Drive file the company does not own is not approved", () => {
  const decision = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ownerEmails: ["other@example.com"],
      capabilities: { canEdit: true, canAddChildren: null },
    }),
    ancestorFolderIds: [],
    config,
    companyEmail: "sheets@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(decision, { ok: false, reason: "not_company_controlled" });
});

test("approved shared drive ancestry is required and other drives are rejected", () => {
  const approved = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [CHILD],
    }),
    ancestorFolderIds: [CHILD, PARENT],
    config,
    companyEmail: "sam@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(approved, { ok: true, basis: "approved_shared_drive" });

  const other = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: "0AOtherDrive000001",
      parents: [CHILD],
      capabilities: { canEdit: true, canAddChildren: true },
    }),
    ancestorFolderIds: [CHILD, PARENT],
    config,
    companyEmail: "sam@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(other, { ok: false, reason: "unapproved_shared_drive" });

  const outside = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: ["1SomewhereElse0001"],
    }),
    ancestorFolderIds: ["1SomewhereElse0001"],
    config,
    companyEmail: "sam@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(outside, { ok: false, reason: "outside_approved_parent" });

  const unconfigured = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
    }),
    ancestorFolderIds: [PARENT],
    config: { approvedSharedDriveId: null, approvedParentFolderId: null },
    companyEmail: "sam@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(unconfigured, { ok: false, reason: "approved_drive_unconfigured" });
});

test("missing edit or add-child capability is not company approval", () => {
  const edit = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      capabilities: { canEdit: false, canAddChildren: true },
    }),
    ancestorFolderIds: [PARENT],
    config,
    companyEmail: null,
    operation: "edit",
  });
  assert.deepEqual(edit, { ok: false, reason: "insufficient_capability" });

  const add = evaluateCompanyStorageFile({
    file: file({
      id: CHILD,
      mimeType: "application/vnd.google-apps.folder",
      driveId: DRIVE,
      capabilities: { canEdit: true, canAddChildren: null },
    }),
    ancestorFolderIds: [PARENT],
    config,
    companyEmail: null,
    operation: "add_child",
  });
  assert.deepEqual(add, { ok: false, reason: "insufficient_capability" });
});

test("ancestry walks to the approved parent and stops for another drive", async () => {
  const sheet = file({
    id: SHEET,
    mimeType: "application/vnd.google-apps.spreadsheet",
    driveId: DRIVE,
    parents: [CHILD],
  });
  const folders = new Map<string, CompanyDriveFile>([
    [CHILD, file({ id: CHILD, mimeType: "application/vnd.google-apps.folder", driveId: DRIVE, parents: [PARENT], capabilities: { canEdit: true, canAddChildren: true } })],
    [PARENT, file({ id: PARENT, mimeType: "application/vnd.google-apps.folder", driveId: DRIVE, capabilities: { canEdit: true, canAddChildren: true } })],
  ]);
  const walked = await collectSharedDriveAncestors(sheet, DRIVE, PARENT, async (fileId) => {
    const found = folders.get(fileId);
    if (!found) return { ok: false, reason: "not_found" };
    return { ok: true, file: found };
  });
  assert.equal(walked.ok, true);
  if (!walked.ok) return;
  assert.deepEqual(walked.ancestorFolderIds, [CHILD, PARENT]);

  const foreign = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: ["1ForeignParent00001"],
    }),
    DRIVE,
    PARENT,
    async () => ({
      ok: true,
      file: file({
        id: "1ForeignParent00001",
        mimeType: "application/vnd.google-apps.folder",
        driveId: "0AOtherDrive000001",
      }),
    })
  );
  assert.deepEqual(foreign, { ok: false, reason: "unapproved_shared_drive" });
});

test("partial shared-drive configuration does not approve a shared-drive file", () => {
  const sheet = file({
    id: SHEET,
    mimeType: "application/vnd.google-apps.spreadsheet",
    driveId: DRIVE,
    parents: [PARENT],
    capabilities: { canEdit: true, canAddChildren: true },
  });
  const base = { file: sheet, ancestorFolderIds: [PARENT], companyEmail: "sam@lifeagentlaunch.com", operation: "edit" as const };
  assert.deepEqual(
    evaluateCompanyStorageFile({ ...base, config: { approvedSharedDriveId: DRIVE, approvedParentFolderId: null } }),
    { ok: false, reason: "approved_parent_unconfigured" }
  );
  assert.deepEqual(
    evaluateCompanyStorageFile({ ...base, config: { approvedSharedDriveId: null, approvedParentFolderId: PARENT } }),
    { ok: false, reason: "approved_drive_unconfigured" }
  );
  assert.deepEqual(
    evaluateCompanyStorageFile({ ...base, config: { approvedSharedDriveId: null, approvedParentFolderId: null } }),
    { ok: false, reason: "approved_drive_unconfigured" }
  );
});

test("trashed files, shortcuts, cycles, inaccessible parents, and deep chains are rejected", async () => {
  const trashedSheet = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [PARENT],
      trashed: true,
    }),
    ancestorFolderIds: [PARENT],
    config,
    companyEmail: null,
    operation: "edit",
  });
  assert.deepEqual(trashedSheet, { ok: false, reason: "trashed_file" });

  const shortcutSheet = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.shortcut",
      driveId: DRIVE,
      parents: [PARENT],
      shortcutTargetId: "1RealSheet00000001",
    }),
    ancestorFolderIds: [PARENT],
    config,
    companyEmail: null,
    operation: "edit",
  });
  assert.deepEqual(shortcutSheet, { ok: false, reason: "shortcut_bypass" });

  const trashedMine = evaluateCompanyStorageFile({
    file: file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ownedByMe: true,
      trashed: true,
    }),
    ancestorFolderIds: [],
    config,
    companyEmail: "sam@lifeagentlaunch.com",
    operation: "edit",
  });
  assert.deepEqual(trashedMine, { ok: false, reason: "trashed_file" });

  const shortcutId = "1ShortcutParent0001";
  let walkedPastShortcut = false;
  const shortcutParent = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [shortcutId],
    }),
    DRIVE,
    PARENT,
    async (fileId) => {
      if (fileId !== shortcutId) walkedPastShortcut = true;
      return {
        ok: true,
        file: file({
          id: shortcutId,
          mimeType: "application/vnd.google-apps.shortcut",
          driveId: DRIVE,
          parents: [PARENT],
          shortcutTargetId: PARENT,
        }),
      };
    }
  );
  assert.deepEqual(shortcutParent, { ok: false, reason: "shortcut_bypass" });
  assert.equal(walkedPastShortcut, false);

  const trashedParent = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [PARENT],
    }),
    DRIVE,
    PARENT,
    async () => ({
      ok: true,
      file: file({
        id: PARENT,
        mimeType: "application/vnd.google-apps.folder",
        driveId: DRIVE,
        trashed: true,
        capabilities: { canEdit: true, canAddChildren: true },
      }),
    })
  );
  assert.deepEqual(trashedParent, { ok: false, reason: "trashed_file" });

  const missingParent = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [CHILD],
    }),
    DRIVE,
    PARENT,
    async () => ({ ok: false, reason: "not_found" })
  );
  assert.deepEqual(missingParent, { ok: false, reason: "ancestry_unavailable" });

  const deniedParent = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [CHILD],
    }),
    DRIVE,
    PARENT,
    async () => ({ ok: false, reason: "access_denied" })
  );
  assert.deepEqual(deniedParent, { ok: false, reason: "ancestry_unavailable" });

  const left = "1CycleLeftFolder0001";
  const right = "1CycleRightFolder001";
  const cycle = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [left],
    }),
    DRIVE,
    PARENT,
    async (fileId) => ({
      ok: true,
      file: file({
        id: fileId,
        mimeType: "application/vnd.google-apps.folder",
        driveId: DRIVE,
        parents: [fileId === left ? right : left],
        capabilities: { canEdit: true, canAddChildren: true },
      }),
    })
  );
  assert.deepEqual(cycle, { ok: false, reason: "ancestry_cycle" });

  const depthId = (n: number) => `1DepthFolder${String(n).padStart(4, "0")}01`;
  const deep = await collectSharedDriveAncestors(
    file({
      id: SHEET,
      mimeType: "application/vnd.google-apps.spreadsheet",
      driveId: DRIVE,
      parents: [depthId(1)],
    }),
    DRIVE,
    PARENT,
    async (fileId) => {
      const match = /^1DepthFolder(\d{4})01$/.exec(fileId);
      const depth = match ? Number(match[1]) : 0;
      return {
        ok: true,
        file: file({
          id: fileId,
          mimeType: "application/vnd.google-apps.folder",
          driveId: DRIVE,
          parents: [depth >= 21 ? PARENT : depthId(depth + 1)],
          capabilities: { canEdit: true, canAddChildren: true },
        }),
      };
    }
  );
  assert.deepEqual(deep, { ok: false, reason: "ancestry_limit" });
});
