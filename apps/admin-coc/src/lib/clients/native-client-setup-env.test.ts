import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isNativeClientSetupEnabled } from "./native-client-setup-env";

test("Admin setup mutations default off independently of API availability", () => {
  assert.equal(isNativeClientSetupEnabled({}), false);
  assert.equal(
    isNativeClientSetupEnabled({ SA360_NATIVE_CLIENT_SETUP_ENABLED: " false " }),
    false
  );
  assert.equal(
    isNativeClientSetupEnabled({ SA360_NATIVE_CLIENT_SETUP_ENABLED: " TRUE " }),
    true
  );
});

test("saveClientSetupAction enforces the Admin flag before calling the API", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.resolve(here, "../../app/actions/clients.ts"),
    "utf8"
  );
  const action = source.slice(
    source.indexOf("export async function saveClientSetupAction"),
    source.indexOf("export async function issuePortalInviteAction")
  );
  const flagCheck = action.indexOf("if (!isNativeClientSetupEnabled())");
  const apiCall = action.indexOf("patchAdminClientSetup(");
  assert.ok(flagCheck >= 0, "save action must enforce its own feature flag");
  assert.ok(apiCall > flagCheck, "feature denial must occur before any API mutation");
});
