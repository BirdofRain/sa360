import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import {
  buildCampaignIdentityFingerprints,
  CAMPAIGN_IDENTITY_MATCH_OUTCOME,
  findExistingCampaignInventoryIdentity,
  historicalInventoryItemStillMatches,
} from "./campaign-inventory-identity.js";

const PHONE = "+15550100001";
const EMAIL = "same@example.test";
const phoneFingerprint = fingerprintIdentityValue("phone", PHONE);
const emailFingerprint = fingerprintIdentityValue("email", EMAIL);

function fingerprints() {
  return buildCampaignIdentityFingerprints({
    contact: { phone_e164: PHONE, email: EMAIL, state: "TX" },
  });
}

test("identity match outcomes stay aligned with stored tracking codes", () => {
  assert.deepEqual(CAMPAIGN_IDENTITY_MATCH_OUTCOME, {
    same_event: "reused_same_event",
    source_lead_id: "reused_source_lead_id",
    phone_fingerprint: "reused_phone",
    email_fingerprint: "reused_email",
    historical_json_compat: "reused_historical",
  });
});

test("historical reuse confirmation reads one item and the indexed JSON paths", async () => {
  const calls: string[] = [];
  const db = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(String.raw({ raw: strings }));
      assert.equal(values[0], "inv_hist");
      return [{ id: "inv_hist" }];
    },
  };
  const matched = await historicalInventoryItemStillMatches(
    {
      inventoryItemId: "inv_hist",
      channel: "phone_fingerprint",
      fingerprints: fingerprints(),
    },
    db as never
  );
  assert.equal(matched, true);
  assert.match(calls[0] ?? "", /LIMIT 1/);
  assert.match(calls[0] ?? "", /i\.id =/);
  assert.match(calls[0] ?? "", /phoneFingerprint" IS NULL/);
  assert.match(calls[0] ?? "", /#>> '\{phone_e164\}'/);
  assert.match(calls[0] ?? "", /#>> '\{contact,phone_e164\}'/);

  const skipped = await historicalInventoryItemStillMatches(
    {
      inventoryItemId: "inv_hist",
      channel: "email_fingerprint",
      fingerprints: {
        phoneE164: PHONE,
        email: null,
        phoneFingerprint,
        emailFingerprint: null,
      },
    },
    db as never
  );
  assert.equal(skipped, false);
  assert.equal(calls.length, 1);
});

test("fingerprints match aged-import identity hash", () => {
  const built = fingerprints();
  assert.equal(built.phoneFingerprint, phoneFingerprint);
  assert.equal(built.emailFingerprint, emailFingerprint);
});

test("same source event reuses inventory via unique sourceLeadEventId", async () => {
  const queries: string[] = [];
  const db = {
    leadInventoryItem: {
      findUnique: async () => {
        queries.push("byEvent");
        return { id: "inv_1", sourceLeadEventId: "evt_1" };
      },
      findFirst: async () => {
        queries.push("fingerprint");
        return null;
      },
    },
    sourceLeadEvent: {
      findFirst: async () => {
        queries.push("bySourceLeadId");
        return null;
      },
    },
    $queryRaw: async () => {
      queries.push("json");
      return [];
    },
  };

  const result = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: "evt_1",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "leadgen_1",
      fingerprints: fingerprints(),
    },
    db as never
  );
  assert.equal(result.hit?.match, "same_event");
  assert.equal(result.hit?.inventoryItemId, "inv_1");
  assert.deepEqual(queries, ["byEvent"]);
  assert.equal(result.diagnostics.jsonCorpusScan, false);
  assert.equal(result.diagnostics.unboundedFindMany, false);
});

test("provider/system/sourceLeadId exact match reuses inventory", async () => {
  const db = {
    leadInventoryItem: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
    sourceLeadEvent: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        assert.equal(args.where.sourceProvider, "facebook");
        assert.equal(args.where.sourceSystem, "meta_lead_ads");
        assert.equal(args.where.sourceLeadId, "leadgen_1");
        return { id: "evt_prior", leadInventoryItem: { id: "inv_prior" } };
      },
    },
    $queryRaw: async () => [],
  };
  const result = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: "evt_new",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "leadgen_1",
      fingerprints: fingerprints(),
    },
    db as never
  );
  assert.equal(result.hit?.match, "source_lead_id");
  assert.equal(result.hit?.inventoryItemId, "inv_prior");
  assert.equal(result.diagnostics.jsonCorpusScan, false);
});

test("same canonical phone from another event reuses inventory", async () => {
  const db = {
    leadInventoryItem: {
      findUnique: async () => null,
      findFirst: async (args: { where: Record<string, unknown> }) => {
        if (args.where.phoneFingerprint === phoneFingerprint) {
          return { id: "inv_phone", sourceLeadEventId: "evt_old" };
        }
        return null;
      },
    },
    sourceLeadEvent: { findFirst: async () => null },
    $queryRaw: async () => [],
  };
  const result = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: "evt_new",
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "lc-other",
      fingerprints: fingerprints(),
    },
    db as never
  );
  assert.equal(result.hit?.match, "phone_fingerprint");
  assert.equal(result.diagnostics.jsonCorpusScan, false);
});

test("same canonical email from another event reuses inventory", async () => {
  const db = {
    leadInventoryItem: {
      findUnique: async () => null,
      findFirst: async (args: { where: Record<string, unknown> }) => {
        if (args.where.emailFingerprint === emailFingerprint) {
          return { id: "inv_email", sourceLeadEventId: "evt_old" };
        }
        return null;
      },
    },
    sourceLeadEvent: { findFirst: async () => null },
    $queryRaw: async () => [],
  };
  const result = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: "evt_new",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "leadgen_other",
      fingerprints: {
        phoneE164: null,
        email: EMAIL,
        phoneFingerprint: null,
        emailFingerprint,
      },
    },
    db as never
  );
  assert.equal(result.hit?.match, "email_fingerprint");
});

test("historical unfingerprinted inventory uses bounded JSON compat only", async () => {
  let rawSql = "";
  const db = {
    leadInventoryItem: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
    sourceLeadEvent: { findFirst: async () => null },
    $queryRaw: async (strings: TemplateStringsArray) => {
      rawSql = String.raw({ raw: strings });
      assert.match(rawSql, /LIMIT 1/);
      assert.match(rawSql, /phoneFingerprint" IS NULL/);
      return [{ id: "inv_hist", sourceLeadEventId: "evt_hist" }];
    },
  };
  const result = await findExistingCampaignInventoryIdentity(
    {
      sourceLeadEventId: "evt_new",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "leadgen_new",
      fingerprints: fingerprints(),
    },
    db as never
  );
  assert.equal(result.hit?.match, "historical_json_compat");
  assert.equal(result.diagnostics.jsonCorpusScan, false);
  assert.equal(result.diagnostics.unboundedFindMany, false);
  assert.ok(result.diagnostics.queryCount <= 5);
});
