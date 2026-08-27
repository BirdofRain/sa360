import assert from "node:assert/strict";
import test from "node:test";

import {
  detectNextGenRouteKeyIdentityMismatch,
  resolveNextGenSourceIdentity,
} from "./leadcapture-nextgen-source-identity.js";

const ANDRU_FUNNEL_ID = "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718";
const ALEX_FUNNEL_ID = "22ac7ad2-97a3-4fce-bd4d-02124b6e4520";
const ANDRU_ROUTE = "LCIO_NG_NURSE_ANDRU_DURANSO";

test("funnel_id wins over copied route key and campaign_id", () => {
  const identity = resolveNextGenSourceIdentity(
    {
      funnel_id: ALEX_FUNNEL_ID,
      funnel_name: "Life Insurance For Nurses- Alex Feuerstein",
      sa360_route_key: ANDRU_ROUTE,
      campaign_id: ANDRU_ROUTE,
    },
    ANDRU_ROUTE
  );
  assert.equal(identity.sourceCampaignId, ALEX_FUNNEL_ID);
  assert.equal(identity.sourceCampaignName, "Life Insurance For Nurses- Alex Feuerstein");
  assert.equal(identity.stableSourceIdKind, "funnel_id");
  assert.equal(identity.routeKey, ANDRU_ROUTE);
  assert.equal(identity.routeKeyIdentityMismatch, true);
});

test("Andru identity stays Andru when route key matches the funnel name", () => {
  const identity = resolveNextGenSourceIdentity(
    {
      funnel_id: ANDRU_FUNNEL_ID,
      funnel_name: "Life Insurance For Nurses- Andru Duranso",
      sa360_route_key: ANDRU_ROUTE,
      campaign_id: ANDRU_ROUTE,
    },
    ANDRU_ROUTE
  );
  assert.equal(identity.sourceCampaignId, ANDRU_FUNNEL_ID);
  assert.equal(identity.sourceCampaignName, "Life Insurance For Nurses- Andru Duranso");
  assert.equal(identity.routeKeyIdentityMismatch, false);
});

test("form_id is used when funnel_id is absent", () => {
  const identity = resolveNextGenSourceIdentity(
    {
      form_id: "form-stable-1",
      form_name: "Life Insurance For Veterans - Example Agent",
      sa360_route_key: "UNKNOWN_ROUTE",
    },
    "UNKNOWN_ROUTE"
  );
  assert.equal(identity.sourceCampaignId, "form-stable-1");
  assert.equal(identity.stableSourceIdKind, "form_id");
  assert.equal(identity.routeKeyIdentityMismatch, false);
});

test("UUID campaign_id is accepted only when it is not a copied route key", () => {
  const identity = resolveNextGenSourceIdentity(
    {
      campaign_id: "11111111-2222-4333-8444-555555555555",
      campaign_name: "Standalone NextGen Form",
    },
    "UNKNOWN_ROUTE"
  );
  assert.equal(identity.sourceCampaignId, "11111111-2222-4333-8444-555555555555");
  assert.equal(identity.stableSourceIdKind, "campaign_id");
});

test("route-key-shaped campaign_id is not treated as source identity", () => {
  const identity = resolveNextGenSourceIdentity(
    {
      campaign_id: ANDRU_ROUTE,
      sa360_campaign_name: "Copied webhook",
    },
    ANDRU_ROUTE
  );
  assert.equal(identity.sourceCampaignId, ANDRU_ROUTE);
  assert.equal(identity.stableSourceIdKind, "route_key");
});

test("mismatch detector ignores generic route keys", () => {
  assert.equal(
    detectNextGenRouteKeyIdentityMismatch({
      stableSourceId: ALEX_FUNNEL_ID,
      sourceName: "Life Insurance For Nurses- Alex Feuerstein",
      routeKey: "UNKNOWN_ROUTE",
    }),
    false
  );
});
