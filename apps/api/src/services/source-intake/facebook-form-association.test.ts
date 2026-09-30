import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";

import {
  FACEBOOK_ASSOCIATION_EXPLANATIONS,
  captureNextAction,
  classifyConfirmedFacebookFormOwners,
  facebookFormProviderFunnelId,
  parseFacebookFormProviderFunnelId,
  readFacebookId,
} from "./facebook-form-association.js";
import { resolveFacebookFormAssociation } from "./facebook-form-association.service.js";

const here = dirname(fileURLToPath(import.meta.url));
const associationSource = readFileSync(join(here, "facebook-form-association.service.ts"), "utf8");
const captureSource = readFileSync(join(here, "zapier-facebook-capture.service.ts"), "utf8");
const reevalSource = readFileSync(join(here, "facebook-capture-reevaluate.service.ts"), "utf8");

test("Facebook form association key is page plus form and ignores campaign", () => {
  const key = facebookFormProviderFunnelId("900000000000101", "900000000000201");
  assert.equal(key, "fbpage:900000000000101:fbform:900000000000201");
  assert.deepEqual(parseFacebookFormProviderFunnelId(key), {
    pageId: "900000000000101",
    formId: "900000000000201",
  });
  assert.equal(parseFacebookFormProviderFunnelId("utm:900000000000201"), null);
});

test("Facebook IDs stay strings and reject unsafe numbers", () => {
  assert.deepEqual(readFacebookId("900000000000101"), { ok: true, value: "900000000000101" });
  assert.deepEqual(readFacebookId(900000000000101), { ok: true, value: "900000000000101" });
  assert.equal(readFacebookId(Number.MAX_SAFE_INTEGER + 2).ok, false);
  assert.equal(readFacebookId("form-name").ok, false);
  assert.equal(readFacebookId("").ok, false);
});

test("confirmed owners classify as associated, missing, or ambiguous", () => {
  assert.equal(classifyConfirmedFacebookFormOwners([null, "  "]), "unassociated");
  assert.equal(classifyConfirmedFacebookFormOwners(["client_a", "client_a"]), "associated");
  assert.equal(classifyConfirmedFacebookFormOwners(["client_a", "client_b"]), "ambiguous");
});

test("ambiguous Page ID + Form ID resolution leaves the lead unassigned", async () => {
  const db = {
    sourceFunnel: {
      findMany: async () => [
        { id: "funnel_a", originClientAccountId: "client_a" },
        { id: "funnel_b", originClientAccountId: "client_b" },
      ],
    },
  } as unknown as Prisma.TransactionClient;
  const result = await resolveFacebookFormAssociation(
    {
      pageId: "900000000000101",
      formId: "900000000000201",
      formIdentityStatus: "present",
    },
    db
  );
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.clientAccountId, null);
  assert.match(result.explanation, /left unassigned/);
  assert.match(captureNextAction("associated"), /No delivery was attempted/);
  assert.match(captureNextAction("ambiguous"), /left unassigned/);
  assert.doesNotMatch(captureNextAction("unassociated"), /approve delivery/i);
  assert.match(FACEBOOK_ASSOCIATION_EXPLANATIONS.unassociated, /GHL delivery setup is not required/);
});

test("capture and association services do not deliver, track inventory, or stamp funnel origin", () => {
  const combined = `${associationSource}\n${captureSource}\n${reevalSource}`;
  assert.doesNotMatch(combined, /persistRoutingAndDuplicate|enqueueGhl|trackCampaignInventory|leadInventoryItem\.create|enqueueMetaDispatch|metaDispatchAttempt/);
  assert.doesNotMatch(combined, /SA360_LEADCONDUIT_MASTER_CLIENT_ACCOUNT_ID|SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID/);
  assert.doesNotMatch(associationSource, /stampNullOriginOnFunnelInventory|applySourceFunnelOriginReassignment|confirmSourceFunnelOrigin/);
  assert.match(captureNextAction("missing_form_identity"), /does not block capture/);
});
