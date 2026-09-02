import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_UNSAVED_EMAIL_INVITE_COPY,
  buildPortalSettingsPatch,
  canonicalPortalLoginEmail,
  hasUnsavedPortalLoginEmailChange,
} from "./portal-login-email-edit.ts";

test("canonicalPortalLoginEmail trims and treats empty as blank", () => {
  assert.equal(canonicalPortalLoginEmail("  alex@example.com  "), "alex@example.com");
  assert.equal(canonicalPortalLoginEmail(null), "");
  assert.equal(canonicalPortalLoginEmail(undefined), "");
  assert.equal(canonicalPortalLoginEmail(""), "");
});

test("unsaved change is false until edit mode has a different draft", () => {
  assert.equal(
    hasUnsavedPortalLoginEmailChange({
      editing: false,
      saved: "alex@example.com",
      draft: "operator@admin.example",
    }),
    false
  );
  assert.equal(
    hasUnsavedPortalLoginEmailChange({
      editing: true,
      saved: "alex@example.com",
      draft: "alex@example.com",
    }),
    false
  );
  assert.equal(
    hasUnsavedPortalLoginEmailChange({
      editing: true,
      saved: "alex@example.com",
      draft: "  alex@example.com  ",
    }),
    false
  );
  assert.equal(
    hasUnsavedPortalLoginEmailChange({
      editing: true,
      saved: "alex@example.com",
      draft: "operator@admin.example",
    }),
    true
  );
});

test("browser-like mutation of a missing field cannot appear in the save patch", () => {
  const fd = new FormData();
  fd.set("portalEnabled", "on");
  fd.set("portalDisplayName", "Valley Portal");
  const patch = buildPortalSettingsPatch(fd);
  assert.equal(patch.portalEnabled, true);
  assert.equal(patch.portalDisplayName, "Valley Portal");
  assert.equal("portalLoginEmail" in patch, false);
});

test("intentional edit field is the only portalLoginEmail submitted", () => {
  const fd = new FormData();
  fd.set("portalEnabled", "on");
  fd.set("portalDisplayName", "Valley Portal");
  fd.set("portalLoginEmail", "  new.owner@example.com  ");
  assert.deepEqual(buildPortalSettingsPatch(fd), {
    portalEnabled: true,
    portalDisplayName: "Valley Portal",
    portalLoginEmail: "new.owner@example.com",
  });
});

test("empty submitted edit field clears portalLoginEmail explicitly", () => {
  const fd = new FormData();
  fd.set("portalDisplayName", "");
  fd.set("portalLoginEmail", "   ");
  assert.deepEqual(buildPortalSettingsPatch(fd), {
    portalEnabled: false,
    portalDisplayName: null,
    portalLoginEmail: null,
  });
});

test("unsaved-email invite copy is the required operator sentence", () => {
  assert.equal(PORTAL_UNSAVED_EMAIL_INVITE_COPY, "Save the login email before generating an invite.");
});
