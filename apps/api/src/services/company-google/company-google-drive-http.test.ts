import assert from "node:assert/strict";
import test from "node:test";

import {
  companyAccountOwnsDriveFile,
  createCompanyDriveFile,
  findCompanyDriveChildFolder,
  getCompanyDriveFile,
  parseCompanyDriveFile,
} from "./company-google-drive-http.js";

test("Drive file metadata parses ownership without listing files", () => {
  const file = parseCompanyDriveFile(
    {
      id: "sheet1",
      name: "Acme Leads",
      mimeType: "application/vnd.google-apps.spreadsheet",
      ownedByMe: false,
      owners: [{ emailAddress: "Sheets@LifeAgentLaunch.com" }],
    },
    "sheet1"
  );
  assert.ok(file);
  assert.equal(companyAccountOwnsDriveFile(file, "sheets@lifeagentlaunch.com"), true);
  assert.equal(companyAccountOwnsDriveFile({ ownedByMe: false, ownerEmails: ["other@example.com"] }, "sheets@lifeagentlaunch.com"), false);
  assert.equal(companyAccountOwnsDriveFile({ ownedByMe: true, ownerEmails: [] }, null), true);
  const shared = parseCompanyDriveFile(
    {
      id: "sheet1",
      name: "Shared",
      mimeType: "application/vnd.google-apps.spreadsheet",
      ownedByMe: true,
      driveId: "0ASharedDrive",
      owners: [{ emailAddress: "sheets@lifeagentlaunch.com" }],
    },
    "sheet1"
  );
  assert.ok(shared);
  assert.equal(shared?.driveId, "0ASharedDrive");
  assert.equal(companyAccountOwnsDriveFile(shared!, "sheets@lifeagentlaunch.com"), false);
});

test("Drive client fetches one file and refuses a file list", async () => {
  let requested = "";
  const fetchImpl: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        id: "file1",
        name: "Folder",
        mimeType: "application/vnd.google-apps.folder",
        ownedByMe: true,
        owners: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const result = await getCompanyDriveFile({ fileId: "file1", accessToken: "token" }, fetchImpl);
  assert.equal(result.ok, true);
  assert.match(requested, /\/drive\/v3\/files\/file1\?/);
  assert.match(requested, /supportsAllDrives=true/);
  assert.equal(requested.includes("supportsAllDrives=false"), false);
  assert.equal(requested.includes("/files?"), false);
  assert.equal(requested.includes("q="), false);
});

test("Drive create targets the given folder and does not accept root", async () => {
  let body = "";
  let requested = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    requested = String(input);
    body = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        id: "sheet-new",
        name: "Acme Leads",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["1approvedParent"],
        driveId: "0AApprovedDrive",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const created = await createCompanyDriveFile(
    {
      name: "Acme Leads",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parentId: "1approvedParent",
      accessToken: "token",
    },
    fetchImpl
  );
  assert.equal(created.ok, true);
  assert.match(requested, /supportsAllDrives=true/);
  assert.deepEqual(JSON.parse(body), {
    name: "Acme Leads",
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: ["1approvedParent"],
  });
  await assert.rejects(() =>
    createCompanyDriveFile(
      {
        name: "Acme Leads",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parentId: "root",
        accessToken: "token",
      },
      fetchImpl
    )
  );
});

test("child folder lookup is limited to one parent in one drive", async () => {
  let requested = "";
  const fetchImpl: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({ files: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const found = await findCompanyDriveChildFolder(
    {
      parentId: "1approvedParent",
      name: "client_a",
      driveId: "0AApprovedDrive",
      accessToken: "token",
    },
    fetchImpl
  );
  assert.equal(found.ok, true);
  assert.match(requested, /supportsAllDrives=true/);
  assert.match(requested, /corpora=drive/);
  assert.match(requested, /driveId=0AApprovedDrive/);
  assert.match(requested, /pageSize=10/);
  assert.match(requested, /application%2Fvnd\.google-apps\.folder/);
  assert.equal(requested.includes("q="), true);
  const ambiguous = await findCompanyDriveChildFolder(
    {
      parentId: "1approvedParent",
      name: "client_a",
      driveId: "0AApprovedDrive",
      accessToken: "token",
    },
    async () =>
      new Response(
        JSON.stringify({
          files: [
            { id: "1folderOne000000", name: "client_a", mimeType: "application/vnd.google-apps.folder" },
            { id: "1folderTwo000000", name: "client_a", mimeType: "application/vnd.google-apps.folder" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
  );
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.reason, "ambiguous_client_folder");
});
