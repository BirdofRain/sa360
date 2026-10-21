import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { HISTORICAL_ASSOCIATION_ROUTES } from "./historical-campaign-association-contract.js";
import {
  historicalOwnershipQueriesAreScoped,
  buildHistoricalCampaignCatalogQuery,
  buildHistoricalCampaignProjectionCatalogQuery,
  buildHistoricalOwnershipMetricsQuery,
  describeHistoricalOwnershipDriverError,
  historicalCatalogReadyDecision,
  runHistoricalCampaignCatalog,
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

function sqlTextOf(query: unknown): string {
  if (!query || typeof query !== "object") return "";
  if ("raw" in query && Array.isArray((query as { raw: unknown }).raw)) {
    return (query as { raw: string[] }).raw.join(" ");
  }
  if ("strings" in query && Array.isArray((query as { strings: unknown }).strings)) {
    return sqlPieces(query as { strings: readonly string[]; values: readonly unknown[] }).text;
  }
  return "";
}

function sqlPieces(query: { strings: readonly string[]; values: readonly unknown[] }): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  let text = "";
  query.strings.forEach((part, index) => {
    text += part;
    const value = query.values[index];
    if (value && typeof value === "object" && "strings" in value && "values" in value) {
      const nested = sqlPieces(value as { strings: readonly string[]; values: readonly unknown[] });
      text += nested.text;
      values.push(...nested.values);
      return;
    }
    if (index < query.values.length) values.push(value);
  });
  return { text, values };
}

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
  const query = sqlPieces(buildHistoricalCampaignCatalogQuery(parsed));
  assert.equal(query.text.includes("Vet Label"), false);
  assert.equal(query.values.includes("Vet Label"), true);
  assert.equal(query.text.includes("IS NULL OR"), false);
  assert.equal(query.text.includes('FROM "InventoryLot" l'), true);
  assert.equal(query.text.includes("FROM labeled l2"), false);
  assert.equal(query.text.includes("array_agg(DISTINCT origin_id ORDER BY origin_id)"), true);
  const importOnly = sqlPieces(buildHistoricalCampaignCatalogQuery({
    lotKey: null,
    importRequest: "aged-bulk-vet-382fb5296124",
    niche: null,
    label: null,
    page: 1,
    pageSize: 25,
  }));
  assert.equal(importOnly.text.includes("IS NULL OR"), false);
  assert.equal(importOnly.text.includes('FROM "LeadInventoryItem" i'), true);
  assert.equal(importOnly.text.includes('FROM "InventoryLot" l'), false);
  assert.equal(historicalOwnershipQueriesAreScoped(), true);
  assert.equal(PROTECTED_RESERVATION_ORDER_NUMBER, "LO-1053");
});

test("projection catalog keeps the response contract and drops source-event extraction", () => {
  const request = {
    lotKey: "lot_aged_bulk_vet",
    importRequest: "aged-bulk-vet",
    niche: "vet",
    label: "Vet Label",
    page: 2,
    pageSize: 10,
  };
  const query = sqlPieces(buildHistoricalCampaignProjectionCatalogQuery(request));
  assert.equal(query.text.includes("SourceLeadEvent"), false);
  assert.equal(query.text.includes("rawPayloadJson"), false);
  assert.equal(query.text.includes("normalizedPayloadJson"), false);
  assert.equal(query.text.includes("sourceCampaignName"), false);
  assert.equal(query.text.includes("historical_catalog_projection p"), true);
  assert.equal(query.text.includes("lot_matches AS MATERIALIZED"), true);
  assert.equal(query.text.includes("historical_campaign_ownership_decision"), true);
  assert.equal(query.text.includes("HistoricalCampaignAlias"), true);
  assert.equal(query.text.includes("HistoricalResaleAuthorization"), false);
  assert.equal(query.text.includes("MATERIALIZED"), true);
  assert.equal(query.text.includes('raw_lot."lotKey"'), true);
  assert.equal(query.text.includes('p.lot_key ='), true);
  assert.equal(query.text.includes("p.niche_key ="), true);
  assert.equal(query.text.includes("p.import_request ="), true);
  assert.equal(query.text.includes('raw_item."nicheKey"'), true);
  assert.equal(query.text.includes("Vet Label"), false);
  assert.equal(query.values.includes("Vet Label"), true);
  assert.equal(query.values.includes("lot_aged_bulk_vet"), true);

  const padded = sqlPieces(buildHistoricalCampaignProjectionCatalogQuery({
    lotKey: "  lot_aged",
    importRequest: null,
    niche: " vet",
    label: null,
    page: 1,
    pageSize: 25,
  }));
  assert.equal(padded.text.includes("p.lot_key ="), false);
  assert.equal(padded.text.includes("lot_matches"), false);
  assert.equal(padded.text.includes("p.niche_key ="), false);
  assert.equal(padded.text.includes('raw_lot."lotKey"'), true);
  assert.equal(padded.text.includes('raw_item."nicheKey"'), true);
  assert.equal(padded.text.includes("SourceLeadEvent"), false);

  const metrics = sqlPieces(buildHistoricalOwnershipMetricsQuery([
    {
      ordinal: 0,
      lotKey: "lot_aged_bulk_vet",
      importRequest: "aged-bulk-vet",
      normalizedLabel: "Vet Label",
      originClientAccountIds: ["client_a"],
      ambiguousScope: false,
    },
  ]));
  assert.equal(metrics.text.includes("historical_catalog_projection"), false);
  assert.equal(metrics.text.includes("SourceLeadEvent"), true);
  assert.equal(metrics.values.includes(PROTECTED_RESERVATION_ORDER_NUMBER), true);
});

test("readiness accepts only an explicit boolean and a projection failure does not fall back", async () => {
  assert.equal(historicalCatalogReadyDecision([{ ready: false }]), "legacy");
  assert.equal(historicalCatalogReadyDecision([{ ready: true }]), "projection");
  for (const rows of [[], [{ ready: true }, { ready: false }], [{ ready: null }], [{ ready: "true" }]]) {
    assert.throws(() => historicalCatalogReadyDecision(rows), (error: unknown) => {
      return error instanceof HistoricalOwnershipPreviewError && error.failureCode === "snapshot_failed";
    });
  }

  const calls: string[] = [];
  const tx = {
    async $executeRawUnsafe() {
      return 0;
    },
    async $queryRaw(first: unknown) {
      const text = sqlTextOf(first);
      if (text.includes("set_config")) return [{ set_config: "20000" }];
      if (text.includes("historical_catalog_projection_control")) return [{ ready: true }];
      calls.push(text.includes("historical_catalog_projection p") ? "projection" : "legacy");
      throw { meta: { code: "57014" }, message: "canceling statement due to statement timeout" };
    },
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  await assert.rejects(
    () => runHistoricalCampaignCatalog(db as never, { lotKey: "lot_aged_bulk_vet" }),
    (error: unknown) => error instanceof HistoricalOwnershipPreviewError && error.failureCode === "statement_timeout",
  );
  assert.deepEqual(calls, ["projection"]);
});

test("driver failures keep the SQLSTATE and drop the statement text", () => {
  const timedOut = describeHistoricalOwnershipDriverError({
    name: "PrismaClientKnownRequestError",
    code: "P2010",
    message: "canceling statement due to statement timeout SELECT secret label",
    meta: { code: "57014", message: "ERROR: canceling statement due to statement timeout" },
  });
  assert.equal(timedOut.failureCode, "statement_timeout");
  assert.equal(timedOut.sqlState, "57014");
  assert.equal(JSON.stringify(timedOut).includes("secret"), false);
  const closed = describeHistoricalOwnershipDriverError({
    code: "P2028",
    message: "Transaction already closed",
  });
  assert.equal(closed.failureCode, "snapshot_failed");
  assert.equal(closed.sqlState, null);
  const service = readFileSync(new URL("./historical-campaign-ownership-preview.ts", import.meta.url), "utf8");
  const logStart = service.indexOf("function recordHistoricalOwnershipFailure");
  const logBlock = service.slice(logStart, service.indexOf("function failHistoricalOwnershipRead"));
  assert.equal(logBlock.includes(".message"), false);
  assert.match(logBlock, /historical_ownership_read_failed/);
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
  assert.match(service, /historical_ownership_read_failed/);
  assert.equal(route.includes("ownership-confirmations"), false);
  assert.equal(route.includes("historical-campaign-resale"), false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.registered, true);
});
