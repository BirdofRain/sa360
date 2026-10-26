import assert from "node:assert/strict";
import test from "node:test";

import { decideClientFolderAction, type ClientFolderRecord } from "./company-sheets-client-folder-decision.js";

const recorded = (status: ClientFolderRecord["status"], folderId: string | null = "folder-1"): ClientFolderRecord => ({
  folderId,
  folderTitle: "Acme Insurance",
  status,
});

test("an active recorded folder is reused and an invalid one is not recreated", () => {
  assert.equal(
    decideClientFolderAction({
      intent: "create",
      recorded: recorded("active"),
      nameMatches: [],
      claimHeldByOther: false,
      recordedFolderValid: true,
    }).action,
    "reuse"
  );
  const invalid = decideClientFolderAction({
    intent: "create",
    recorded: recorded("active"),
    nameMatches: [{ folderId: "other", title: "Acme Insurance" }],
    claimHeldByOther: false,
    recordedFolderValid: false,
  });
  assert.equal(invalid.action, "reject");
  if (invalid.action === "reject") assert.equal(invalid.code, "recorded_folder_unavailable");
});

test("one name match is offered and duplicate names require selection", () => {
  const one = decideClientFolderAction({
    intent: "create",
    recorded: null,
    nameMatches: [{ folderId: "folder-1", title: "Acme Insurance" }],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(one.action, "offer");
  const many = decideClientFolderAction({
    intent: "create",
    recorded: null,
    nameMatches: [
      { folderId: "folder-1", title: "Acme Insurance" },
      { folderId: "folder-2", title: "Acme Insurance" },
    ],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(many.action, "reject");
  if (many.action === "reject") {
    assert.equal(many.code, "ambiguous_client_folder");
    assert.equal(many.folders?.length, 2);
  }
});

test("unlink keeps the folder discoverable and a fresh claim blocks a second create", () => {
  const unlinked = decideClientFolderAction({
    intent: "create",
    recorded: recorded("unlinked"),
    nameMatches: [],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(unlinked.action, "offer");
  if (unlinked.action === "offer") assert.equal(unlinked.folders[0]?.source, "recorded");
  const inspect = decideClientFolderAction({
    intent: "inspect",
    recorded: recorded("unlinked"),
    nameMatches: [],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(inspect.action, "offer");
  const busy = decideClientFolderAction({
    intent: "create",
    recorded: recorded("creating", null),
    nameMatches: [],
    claimHeldByOther: true,
    recordedFolderValid: null,
  });
  assert.equal(busy.action, "in_progress");
  const unknown = decideClientFolderAction({
    intent: "create",
    recorded: recorded("unknown", null),
    nameMatches: [],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(unknown.action, "unknown");
});

test("a verified folder can be linked and an unknown folder cannot", () => {
  const linked = decideClientFolderAction({
    intent: "link",
    requestedFolderId: "folder-9",
    recorded: null,
    nameMatches: [],
    claimHeldByOther: false,
    recordedFolderValid: null,
    ancestryVerifiedFolderId: "folder-9",
  });
  assert.deepEqual(linked, { action: "link", folderId: "folder-9" });
  const rejected = decideClientFolderAction({
    intent: "link",
    requestedFolderId: "folder-9",
    recorded: null,
    nameMatches: [],
    claimHeldByOther: false,
    recordedFolderValid: null,
  });
  assert.equal(rejected.action, "reject");
});
