import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { HISTORICAL_ASSOCIATION_ROUTES } from "./historical-campaign-association-contract.js";
import {
  historicalOwnershipQueriesAreScoped,
  buildHistoricalCampaignCatalogQuery,
  buildHistoricalOwnershipMetricsQuery,
} from "./historical-campaign-ownership-preview.js";
import { HistoricalOwnershipPreviewError } from "./historical-ownership-preview-error.js";
import {
  absentAlias,
  hypotheticalOwnershipConfirmation,
  ownershipDecisionFromAliases,
  type OwnershipAliasView,
} from "./historical-ownership-hypothetical.js";
import {
  containsContactLikeText,
  identitiesFromExplicit,
  normalizeJulyCampaignLabel,
  parseHistoricalCatalogRequest,
  parseHistoricalOwnershipPreviewRequest,
  PROTECTED_RESERVATION_ORDER_NUMBER,
} from "./historical-ownership-preview-request.js";

const absent = absentAlias();
const confirmed = (id: string): OwnershipAliasView => ({ status: "confirmed", originClientAccountId: id });

test("july label normalization keeps case and collapses whitespace", () => {
  assert.equal(normalizeJulyCampaignLabel("  Vet   Label "), "Vet Label");
  assert.equal(normalizeJulyCampaignLabel("vet label"), "vet label");
  assert.notEqual(normalizeJulyCampaignLabel("Vet"), normalizeJulyCampaignLabel("vet"));
  assert.equal(normalizeJulyCampaignLabel("   "), null);
  assert.equal(containsContactLikeText("owner@example.test"), true);
  assert.equal(containsContactLikeText("555-010-1234"), true);
  assert.equal(containsContactLikeText("July Vet 2024"), false);
});

test("ownership decision mirror matches the registry matrix", () => {
  assert.equal(ownershipDecisionFromAliases(absent, absent).reason, "no_coverage");
  assert.equal(
    ownershipDecisionFromAliases(confirmed("client_a"), confirmed("client_a")).reason,
    "eligible_scopes_agree"
  );
  assert.equal(
    ownershipDecisionFromAliases(confirmed("client_a"), confirmed("client_a")).originClientAccountId,
    "client_a"
  );
  assert.equal(
    ownershipDecisionFromAliases(confirmed("client_a"), confirmed("client_b")).reason,
    "fail_closed_conflicting_clients"
  );
  assert.equal(
    ownershipDecisionFromAliases(confirmed("client_a"), confirmed("client_b")).originClientAccountId,
    null
  );
  assert.equal(ownershipDecisionFromAliases(confirmed("client_a"), absent).reason, "eligible_lot_only");
  assert.equal(
    ownershipDecisionFromAliases({ status: "retired", originClientAccountId: null }, confirmed("client_b")).reason,
    "eligible_import_request_only"
  );
  assert.equal(
    ownershipDecisionFromAliases(confirmed("client_a"), { status: "suggested", originClientAccountId: null }).reason,
    "fail_closed_ambiguous"
  );
  assert.equal(
    ownershipDecisionFromAliases(
      { status: "suggested", originClientAccountId: null },
      { status: "unassigned", originClientAccountId: null }
    ).reason,
    "fail_closed_ambiguous"
  );
  assert.equal(
    ownershipDecisionFromAliases({ status: "suggested", originClientAccountId: null }, absent).reason,
    "suggestion_is_not_ownership"
  );
  assert.equal(
    ownershipDecisionFromAliases({ status: "conflicted", originClientAccountId: null }, absent).reason,
    "fail_closed_conflicted"
  );
  assert.equal(
    ownershipDecisionFromAliases({ status: "missing_scope", originClientAccountId: null }, { status: "missing_scope", originClientAccountId: null }).reason,
    "fail_closed_missing_scope"
  );
  assert.equal(
    ownershipDecisionFromAliases({ status: "confirmed", originClientAccountId: null }, absent).reason,
    "fail_closed_incomplete_origin"
  );
});

test("hypothetical confirmation does not treat an empty registry as already eligible", () => {
  const projected = hypotheticalOwnershipConfirmation({
    lot: absent,
    importScope: absent,
    proposedOriginClientAccountId: "client_a",
  });
  assert.equal(projected.source, "hypothetical_not_persisted");
  assert.equal(projected.registryWritePerformed, false);
  assert.equal(projected.decision, "eligible");
  assert.equal(projected.reason, "eligible_scopes_agree");
  assert.equal(projected.originClientAccountId, "client_a");
  assert.equal(ownershipDecisionFromAliases(absent, absent).reason, "no_coverage");
});

test("hypothetical confirmation rejects retired, conflicted, and other-client aliases", () => {
  assert.equal(
    hypotheticalOwnershipConfirmation({
      lot: { status: "retired", originClientAccountId: null },
      importScope: absent,
      proposedOriginClientAccountId: "client_a",
    }).rejection,
    "confirmation_would_be_rejected"
  );
  assert.equal(
    hypotheticalOwnershipConfirmation({
      lot: { status: "conflicted", originClientAccountId: null },
      importScope: confirmed("client_a"),
      proposedOriginClientAccountId: "client_a",
    }).rejection,
    "confirmation_would_be_rejected"
  );
  assert.equal(
    hypotheticalOwnershipConfirmation({
      lot: confirmed("client_b"),
      importScope: absent,
      proposedOriginClientAccountId: "client_a",
    }).rejection,
    "existing_other_origin"
  );
  const same = hypotheticalOwnershipConfirmation({
    lot: confirmed("client_a"),
    importScope: confirmed("client_a"),
    proposedOriginClientAccountId: "client_a",
  });
  assert.equal(same.rejection, null);
  assert.equal(same.reason, "eligible_scopes_agree");
  assert.equal(
    hypotheticalOwnershipConfirmation({
      lot: absent,
      importScope: absent,
      proposedOriginClientAccountId: "client_a",
      duplicateProposal: true,
    }).rejection,
    "duplicate_proposal"
  );
});

test("catalog requests require a scope and keep labels out of SQL text", () => {
  assert.throws(() => parseHistoricalCatalogRequest({}), (error: unknown) => {
    return error instanceof HistoricalOwnershipPreviewError && error.failureCode === "historical_campaign_catalog_scope_required";
  });
  const parsed = parseHistoricalCatalogRequest({
    lotKey: "lot_aged_bulk_vet_382fb5296124",
    label: "  Vet   Label ",
    page: 2,
    pageSize: 10,
  });
  assert.equal(parsed.label, "Vet Label");
  assert.equal(parsed.page, 2);
  const query = buildHistoricalCampaignCatalogQuery(parsed);
  assert.equal(query.strings.join("").includes("Vet Label"), false);
  assert.equal(query.values.includes("Vet Label"), true);
  assert.equal(historicalOwnershipQueriesAreScoped(), true);
  assert.equal(PROTECTED_RESERVATION_ORDER_NUMBER, "LO-1053");
});

test("preview requests reject confirmation, contact files, and duplicate labels across clients", () => {
  assert.throws(
    () => parseHistoricalOwnershipPreviewRequest({ confirm: true, campaigns: [] }),
    (error: unknown) =>
      error instanceof HistoricalOwnershipPreviewError &&
      error.failureCode === "historical_ownership_confirmation_not_available"
  );
  assert.throws(
    () =>
      parseHistoricalOwnershipPreviewRequest({
        mappingText: "lotKey,importRequest,normalizedLabel,originClientAccountId\nlot_a,imp_a,secret@example.test,client_a\n",
        proposedOriginClientAccountId: "client_a",
      }),
    (error: unknown) => error instanceof HistoricalOwnershipPreviewError && error.failureCode === "mapping_rejected"
  );
  const parsed = parseHistoricalOwnershipPreviewRequest({
    proposedOriginClientAccountId: "client_a",
    campaigns: [{ lotKey: "lot_a", importRequest: "imp_a", normalizedLabel: "  Alpha   One " }],
    mappingText: "lotKey,importRequest,normalizedLabel\nlot_a,imp_b,Alpha One\nlot_a,imp_a,Alpha One\n",
  });
  assert.equal(parsed.explicit.length, 3);
  const identities = identitiesFromExplicit(parsed.explicit);
  assert.equal(identities.length, 2);
  const duplicate = identities.find((identity) => identity.importRequest === "imp_a");
  assert.equal(duplicate?.originClientAccountIds.length, 1);
  const split = parseHistoricalOwnershipPreviewRequest({
    campaigns: [
      { lotKey: "lot_a", importRequest: "imp_a", normalizedLabel: "Alpha", originClientAccountId: "client_a" },
      { lotKey: "lot_a", importRequest: "imp_a", normalizedLabel: "Alpha", originClientAccountId: "client_b" },
    ],
  });
  assert.equal(identitiesFromExplicit(split.explicit)[0]?.originClientAccountIds.length, 2);
  const metrics = buildHistoricalOwnershipMetricsQuery(identitiesFromExplicit(parsed.explicit));
  assert.equal(metrics.strings.join("").includes("Alpha One"), false);
  assert.equal(metrics.values.includes("Alpha One"), true);
});

test("ownership preview source stays read-only and leaves confirmation unregistered", () => {
  const service = readFileSync(new URL("./historical-campaign-ownership-preview.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../routes/admin-historical-campaign-association.ts", import.meta.url), "utf8");
  assert.equal(service.includes(".create("), false);
  assert.equal(service.includes(".update("), false);
  assert.equal(service.includes(".delete("), false);
  assert.equal(service.includes("INSERT"), false);
  assert.match(service, /SET TRANSACTION READ ONLY/);
  assert.match(route, /logLevel: "silent"/);
  assert.equal(route.includes("request.log"), false);
  assert.equal(route.includes("ownership-confirmations"), false);
  assert.equal(route.includes("historical-campaign-resale"), false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.registered, true);
});
