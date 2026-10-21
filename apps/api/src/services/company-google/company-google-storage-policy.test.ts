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
