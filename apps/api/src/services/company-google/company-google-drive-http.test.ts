import assert from "node:assert/strict";
import test from "node:test";

import {
  companyAccountOwnsDriveFile,
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
  assert.equal(requested.includes("/files?"), false);
  assert.equal(requested.includes("q="), false);
});
