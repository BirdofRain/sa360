/**
 * Resolving or browsing a pasted folder does not link, save, or bind a destination.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveOnboardingFolder } from "./sheet-preview.js";

const enabled = { SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true" } as NodeJS.ProcessEnv;

test("folder resolve returns the browse step and does not save", async () => {
  let calls = 0;
  const resolved = await resolveOnboardingFolder("client_mock", "folder_mock", {
    env: enabled,
    resolveFolder: async () => {
      calls += 1;
      return {
        ok: true as const,
        folder: { folderId: "folder_mock", title: "Mock folder", driveId: null, basis: "my_drive_owner" as const },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.saved, false);
  assert.equal(resolved.linked, false);
  assert.equal(resolved.next.action, "browse_spreadsheets");
  assert.equal(resolved.next.savesFolder, false);
  assert.equal(resolved.next.savesDestination, false);
  assert.equal(resolved.next.path, "/admin/v1/clients/client_mock/onboarding/drive/spreadsheets");
});
