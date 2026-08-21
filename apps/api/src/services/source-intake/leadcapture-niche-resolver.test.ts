import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTrustedLeadCaptureRouteNiche,
  resolveLeadCaptureNiche,
} from "./leadcapture-niche-resolver.js";

test("legacy and NextGen VET stay VET with Veteran / Final Expense defaults", () => {
  const legacy = resolveLeadCaptureNiche({ niche_key: "VET" });
  assert.equal(legacy.resolved, true);
  assert.equal(legacy.nicheKey, "VET");
  assert.equal(legacy.leadType, "VET");
  assert.equal(legacy.nicheLabel, "Veteran");
  assert.equal(legacy.productType, "Final Expense");

  const nextgen = resolveLeadCaptureNiche({ niche_key: "vet", niche: "NURSE" });
  assert.equal(nextgen.nicheKey, "VET");
  assert.equal(nextgen.leadType, "VET");
});

test("NextGen recognized niches keep business keys and do not stamp Veteran or Final Expense", () => {
  for (const key of ["NURSE", "MORTGAGE", "TRUCKER", "HEALTH"] as const) {
    const resolved = resolveLeadCaptureNiche({ niche_key: ` ${key.toLowerCase()} ` });
    assert.equal(resolved.resolved, true, key);
    assert.equal(resolved.nicheKey, key);
    assert.equal(resolved.leadType, key);
    assert.notEqual(resolved.nicheLabel, "Veteran");
    assert.notEqual(resolved.productType, "Final Expense");
    assert.equal(resolved.productType, undefined);
  }
});

test("niche field is used when niche_key is absent", () => {
  const resolved = resolveLeadCaptureNiche({ niche: "MORTGAGE" });
  assert.equal(resolved.nicheKey, "MORTGAGE");
  assert.equal(resolved.leadType, "MORTGAGE");
});

test("explicit product_type is preserved for non-VET niches", () => {
  const resolved = resolveLeadCaptureNiche({
    niche_key: "NURSE",
    product_type: "Term Life",
  });
  assert.equal(resolved.productType, "Term Life");
  assert.notEqual(resolved.nicheLabel, "Veteran");
});

test("missing niche does not become VET", () => {
  const resolved = resolveLeadCaptureNiche({ first_name: "Pat" });
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.nicheKey, undefined);
  assert.equal(resolved.leadType, undefined);
  assert.notEqual(resolved.nicheKey, "VET");
  assert.notEqual(resolved.leadType, "VET");
});

test("unknown niche does not become VET", () => {
  const resolved = resolveLeadCaptureNiche({ niche_key: "WIDGET" });
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.nicheKey, undefined);
  assert.notEqual(resolved.nicheKey, "VET");
  assert.notEqual(resolved.leadType, "VET");
});

test("trusted legacy route-only VET resolves VET with Veteran / Final Expense", () => {
  const resolved = resolveLeadCaptureNiche({
    sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.nicheKey, "VET");
  assert.equal(resolved.leadType, "VET");
  assert.equal(resolved.nicheLabel, "Veteran");
  assert.equal(resolved.productType, "Final Expense");
});

test("trusted NextGen route-only NURSE resolves NURSE without Veteran defaults", () => {
  const resolved = resolveLeadCaptureNiche({
    sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
  });
  assert.equal(resolved.nicheKey, "NURSE");
  assert.equal(resolved.leadType, "NURSE");
  assert.notEqual(resolved.nicheLabel, "Veteran");
  assert.notEqual(resolved.productType, "Final Expense");
});

test("explicit niche wins over a conflicting trusted route", () => {
  const nurseOverVetRoute = resolveLeadCaptureNiche({
    niche_key: "NURSE",
    sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(nurseOverVetRoute.nicheKey, "NURSE");

  const nurseFieldOverVetRoute = resolveLeadCaptureNiche({
    niche: "NURSE",
    sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(nurseFieldOverVetRoute.nicheKey, "NURSE");

  const vetOverNurseRoute = resolveLeadCaptureNiche({
    niche_key: "VET",
    sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
  });
  assert.equal(vetOverNurseRoute.nicheKey, "VET");
  assert.equal(vetOverNurseRoute.nicheLabel, "Veteran");
});

test("unknown explicit niche does not fall through to a VET route", () => {
  const resolved = resolveLeadCaptureNiche({
    niche_key: "WIDGET",
    sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  });
  assert.equal(resolved.resolved, false);
  assert.notEqual(resolved.nicheKey, "VET");
});

test("missing niche plus unrecognized or malformed route stays unresolved", () => {
  for (const route of [
    undefined,
    "UNKNOWN_ROUTE",
    "LC_VET_FEX_TEST",
    "Life Insurance For Veterans",
    "LCIO_LEGACY_",
    "LCIO_LEGACY",
    "LCIO_NG_WIDGET_EXAMPLE",
    "SOME_CAMPAIGN_VET_FEX",
  ]) {
    const resolved = resolveLeadCaptureNiche(
      route ? { sa360_route_key: route } : { first_name: "Pat" }
    );
    assert.equal(resolved.resolved, false, String(route));
    assert.notEqual(resolved.nicheKey, "VET", String(route));
  }
});

test("parseTrustedLeadCaptureRouteNiche reads only the structured niche token", () => {
  assert.equal(
    parseTrustedLeadCaptureRouteNiche("LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX"),
    "VET"
  );
  assert.equal(parseTrustedLeadCaptureRouteNiche("LCIO_NG_NURSE_ANDRU_DURANSO"), "NURSE");
  assert.equal(parseTrustedLeadCaptureRouteNiche("LCIO_NG_MORTGAGE_TEST"), "MORTGAGE");
  assert.equal(parseTrustedLeadCaptureRouteNiche("LCIO_NG_TRUCKER_TEST"), "TRUCKER");
  assert.equal(parseTrustedLeadCaptureRouteNiche("LCIO_NG_HEALTH_TEST"), "HEALTH");
  assert.equal(parseTrustedLeadCaptureRouteNiche("LCIO_NG_WIDGET_EXAMPLE"), undefined);
  assert.equal(parseTrustedLeadCaptureRouteNiche("LC_VET_FEX_TEST"), undefined);
  assert.equal(parseTrustedLeadCaptureRouteNiche("veteran campaign vet"), undefined);
});
