import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  ALLOW_LIST_MAX,
  assembleCorrectionPreview,
  assertPreviewHasNoSensitiveKeys,
  classifyCorrectionCandidate,
  correctionPreviewDigest,
  emptyRelationFlags,
  evaluateCohort,
  type CohortEvaluation,
  type CorrectionCandidate,
} from "./facebook-association-correction-preview.js";
import {
  PREVIEW_STATEMENT_TIMEOUT_MS,
  PREVIEW_TRANSACTION_MAX_WAIT_MS,
  PREVIEW_TRANSACTION_TIMEOUT_MS,
  loadFacebookAssociationCorrectionPreview,
} from "./facebook-association-correction-preview.service.js";

const CONFIRMED_AT = new Date("2026-10-27T14:25:02.000Z");
const PAGE = "222591640945329";
const FORM = "1977370106440985";

function candidate(overrides: Partial<CorrectionCandidate> = {}): CorrectionCandidate {
  return {
    sourceEventId: "event_eligible",
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    pageId: PAGE,
    formId: FORM,
    sourceLeadIdentityPresent: true,
    sourceLeadIdentityFingerprint: "abc123def456",
    sourceLeadUidPresent: true,
    duplicateCanonical: false,
    captureOnly: true,
    captureSettled: true,
    status: "normalized",
    storedAssociationOutcome: "unassociated",
    clientResolved: false,
    campaignPresent: false,
    receivedAt: "2026-10-20T12:00:00.000Z",
    normalizedAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    routingOnEvent: false,
    deliveryOnEvent: false,
    relationFlags: emptyRelationFlags(),
    audit: { count: 0, lastAction: null, lastTimestamp: null, reevaluated: false, unverified: false },
    cleanupMarked: false,
    intakeReceipt: false,
    deliveryQuiet: true,
    ...overrides,
  };
}

function classify(overrides: Partial<CorrectionCandidate> = {}, cohortReasons: CohortEvaluation["reasons"] = []) {
  return classifyCorrectionCandidate(candidate(overrides), {
    pageId: PAGE,
    formId: FORM,
    confirmedAt: CONFIRMED_AT,
    cohortReasons,
  });
}

function cohort(overrides: Partial<CohortEvaluation> = {}): CohortEvaluation {
  return {
    matches: true,
    ambiguous: false,
    reasons: [],
    informational: [],
    funnelCreatedAt: "2026-10-27T14:25:02.789Z",
    funnelUpdatedAt: "2026-10-27T14:25:02.789Z",
    funnelTouchedAfterConfirmation: true,
    confirmedAtVersusFunnelCreatedAt: "before",
    ...overrides,
  };
}

test("a settled unassociated capture with no downstream relationships is eligible", () => {
  const event = classify();
  assert.equal(event.decision, "eligible");
  assert.equal(event.eligible, true);
  assert.deepEqual(event.blockingReasons, []);
  assert.deepEqual(event.informationalReferences, ["delivery_not_recorded"]);
  assert.equal(event.clientAccountIdResolved, null);
  assert.equal(event.relationFlags.exportViaAllocation, false);
});

test("each downstream relationship blocks with its reason code", () => {
  const cases: Array<[Partial<CorrectionCandidate["relationFlags"]>, string]> = [
    [{ fulfillmentOutbox: true }, "fulfillment_relation_present"],
    [{ allocation: true }, "allocation_present"],
    [{ inventory: true }, "fulfillment_relation_present"],
    [{ sheetsDeliveryJob: true }, "sheets_relation_present"],
    [{ ghlOutbox: true }, "ghl_outbox_present"],
    [{ onboardingTest: true }, "onboarding_reference_present"],
    [{ onboardingAudit: true }, "onboarding_reference_present"],
    [{ verificationAudit: true }, "fulfillment_audit_present"],
    [{ routingDecision: true }, "routing_decision_present"],
    [{ lifecycleEvent: true }, "meta_dispatch_present"],
    [{ metaDispatch: true }, "meta_dispatch_present"],
    [{ bulkImport: true }, "bulk_import_reference"],
    [{ externalReceipt: true }, "fulfillment_relation_present"],
  ];
  for (const [flags, reason] of cases) {
    const event = classify({ relationFlags: { ...emptyRelationFlags(), ...flags } });
    assert.equal(event.decision, "blocked", reason);
    assert.ok(event.blockingReasons.includes(reason), reason);
    assert.equal(event.eligible, false);
  }
});

test("delivery timestamps, campaign, cutoff, client, outcome, and prior reevaluation block", () => {
  assert.ok(classify({ deliveryOnEvent: true }).blockingReasons.includes("delivery_timestamp_present"));
  assert.ok(classify({ status: "delivered" }).blockingReasons.includes("delivery_timestamp_present"));
  assert.ok(classify({ status: "approved" }).blockingReasons.includes("status_not_capture_settled"));
  assert.ok(classify({ campaignPresent: true }).blockingReasons.includes("campaign_scope_present"));
  assert.ok(
    classify({ normalizedAt: "2026-10-27T14:25:02.000Z" }).blockingReasons.includes("settled_after_confirmation")
  );
  assert.ok(classify({ receivedAt: null }).blockingReasons.includes("settled_after_confirmation"));
  assert.ok(classify({ clientResolved: true }).blockingReasons.includes("client_already_resolved"));
  assert.equal(classify({ clientResolved: true }).clientAccountIdResolved, true);
  assert.ok(classify({ storedAssociationOutcome: "associated" }).blockingReasons.includes("outcome_not_unassociated"));
  assert.ok(
    classify({
      audit: {
        count: 1,
        lastAction: "reevaluate_association",
        lastTimestamp: "2026-10-27T14:26:21.392Z",
        reevaluated: true,
        unverified: false,
      },
    }).blockingReasons.includes("already_reevaluated")
  );
  assert.ok(classify({ captureSettled: false }).blockingReasons.includes("not_capture_settled"));
  assert.ok(classify({ cleanupMarked: true }).blockingReasons.includes("cleanup_marked"));
  assert.ok(classify({ routingOnEvent: true }).blockingReasons.includes("routing_decision_present"));
  assert.ok(classify({ sourceProvider: "leadcapture_io" }).blockingReasons.includes("not_facebook_capture"));
  assert.ok(classify({ pageId: "100000000000001" }).blockingReasons.includes("form_identity_mismatch"));
});

test("a blank canonical identity is excluded and is not an eligible id", () => {
  const event = classify({ sourceLeadIdentityPresent: false, sourceLeadIdentityFingerprint: "", sourceLeadUidPresent: false });
  assert.equal(event.decision, "excluded");
  assert.ok(event.blockingReasons.includes("identity_less_excluded"));
  assert.equal(event.eligible, false);
});

test("a duplicate canonical identity blocks even when the client is null", () => {
  const event = classify({ duplicateCanonical: true });
  assert.equal(event.decision, "blocked");
  assert.ok(event.blockingReasons.includes("duplicate_canonical_identity"));
});

test("a missing lead uid fails closed instead of treating the event as eligible", () => {
  const event = classify({ sourceLeadUidPresent: false });
  assert.equal(event.decision, "blocked");
  assert.ok(event.blockingReasons.includes("relation_unverified"));
});

test("cohort mismatch and a second confirmed owner make every event ineligible", () => {
  const mismatched = evaluateCohort({
    funnel: null,
    expectedProviderFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    originClientAccountId: "jr_laird",
    confirmedAt: CONFIRMED_AT,
    otherConfirmedOriginCount: 0,
  });
  assert.deepEqual(mismatched.reasons, ["funnel_mismatch"]);
  assert.equal(classify({}, mismatched.reasons).decision, "blocked");

  const ambiguous = evaluateCohort({
    funnel: {
      provider: "facebook",
      providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
      associationStatus: "confirmed",
      originClientAccountId: "jr_laird",
      createdAt: new Date("2026-10-27T14:25:02.789Z"),
      updatedAt: new Date("2026-10-27T14:25:02.789Z"),
    },
    expectedProviderFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    originClientAccountId: "jr_laird",
    confirmedAt: CONFIRMED_AT,
    otherConfirmedOriginCount: 1,
  });
  assert.ok(ambiguous.reasons.includes("ambiguous_owner"));
  assert.equal(ambiguous.funnelTouchedAfterConfirmation, true);
  assert.equal(ambiguous.confirmedAtVersusFunnelCreatedAt, "before");
  assert.equal(classify({}, ambiguous.reasons).eligible, false);
});

test("the cutoff is reported and does not by itself authorize a correction", () => {
  const evaluated = evaluateCohort({
    funnel: {
      provider: "facebook",
      providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
      associationStatus: "confirmed",
      originClientAccountId: "other_client",
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    expectedProviderFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    originClientAccountId: "jr_laird",
    confirmedAt: CONFIRMED_AT,
    otherConfirmedOriginCount: 0,
  });
  assert.deepEqual(evaluated.reasons, ["funnel_mismatch"]);
  assert.equal(evaluated.confirmedAtVersusFunnelCreatedAt, "after");
  assert.equal(evaluated.funnelTouchedAfterConfirmation, false);
});

test("pagination keeps one digest and the allow-list is the full eligible set", () => {
  const events = ["b_event", "a_event", "c_event"].map((id) => classify({ sourceEventId: id }));
  const shared = {
    sourceFunnelId: "funnel_1",
    pageId: PAGE,
    formId: FORM,
    originClientAccountId: "jr_laird",
    providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    confirmedAt: CONFIRMED_AT.toISOString(),
    cohort: cohort(),
    events,
    verificationCode: null,
    includeAllowList: true,
    issuedAt: new Date("2026-11-09T15:00:00.000Z"),
  };
  const first = assembleCorrectionPreview({ ...shared, decision: "all", limit: 1, offset: 0 });
  const second = assembleCorrectionPreview({ ...shared, decision: "all", limit: 1, offset: 1 });
  assert.equal(first.preview.digest, second.preview.digest);
  assert.equal(first.events.items.length, 1);
  assert.notEqual(first.events.items[0]?.sourceEventId, second.events.items[0]?.sourceEventId);
  assert.equal(first.events.total, 3);
  assert.deepEqual(first.allowList, ["a_event", "b_event", "c_event"]);
  assert.equal(first.preview.authorizesExecution, false);
  assert.equal(first.cohort.provenance.authorizesCorrection, false);
  assert.equal(first.cohort.provenance.provesHistoricalOwnership, false);
  assert.equal(first.writesPerformed, false);
  assert.equal(first.preview.expiresAt, "2026-11-09T15:15:00.000Z");
  assert.ok(first.preview.previewId.startsWith(first.preview.digest.slice(0, 16)));
});

test("an allow-list over the bound is omitted and a partial scan cannot mark events eligible", () => {
  const events = Array.from({ length: ALLOW_LIST_MAX + 1 }, (_, index) =>
    classify({ sourceEventId: `event_${String(index).padStart(3, "0")}` })
  );
  const preview = assembleCorrectionPreview({
    sourceFunnelId: "funnel_1",
    pageId: PAGE,
    formId: FORM,
    originClientAccountId: "jr_laird",
    providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    confirmedAt: CONFIRMED_AT.toISOString(),
    cohort: cohort(),
    events,
    verificationCode: null,
    decision: "eligible",
    limit: 25,
    offset: 0,
    includeAllowList: true,
    issuedAt: new Date("2026-11-09T15:00:00.000Z"),
  });
  assert.equal(preview.preview.eligibleCount, 101);
  assert.deepEqual(preview.allowList, []);
  assert.equal(preview.events.total, 101);

  const incomplete = assembleCorrectionPreview({
    sourceFunnelId: "funnel_1",
    pageId: PAGE,
    formId: FORM,
    originClientAccountId: "jr_laird",
    providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    confirmedAt: CONFIRMED_AT.toISOString(),
    cohort: cohort(),
    events,
    verificationCode: "candidate_limit_exceeded",
    decision: "all",
    limit: 25,
    offset: 0,
    includeAllowList: true,
    issuedAt: new Date("2026-11-09T15:00:00.000Z"),
  });
  assert.equal(incomplete.verification.complete, false);
  assert.equal(incomplete.preview.eligibleCount, 0);
  assert.deepEqual(incomplete.allowList, []);
  assert.deepEqual(incomplete.events.items, []);
  assert.equal(
    incomplete.preview.digest,
    correctionPreviewDigest({
      sourceFunnelId: "funnel_1",
      originClientAccountId: "jr_laird",
      pageId: PAGE,
      formId: FORM,
      confirmedAt: CONFIRMED_AT.toISOString(),
      eligible: [],
    })
  );
  assert.equal(JSON.stringify(incomplete).includes("event_000"), false);
});

test("the digest covers the eligible snapshot and ignores page position", () => {
  const left = correctionPreviewDigest({
    sourceFunnelId: "funnel_1",
    originClientAccountId: "jr_laird",
    pageId: PAGE,
    formId: FORM,
    confirmedAt: CONFIRMED_AT.toISOString(),
    eligible: [
      { sourceEventId: "b", fingerprint: "bbbb" },
      { sourceEventId: "a", fingerprint: "aaaa" },
    ],
  });
  const right = correctionPreviewDigest({
    sourceFunnelId: "funnel_1",
    originClientAccountId: "jr_laird",
    pageId: PAGE,
    formId: FORM,
    confirmedAt: CONFIRMED_AT.toISOString(),
    eligible: [
      { sourceEventId: "a", fingerprint: "aaaa" },
      { sourceEventId: "b", fingerprint: "bbbb" },
    ],
  });
  const changed = correctionPreviewDigest({
    sourceFunnelId: "funnel_1",
    originClientAccountId: "jr_laird",
    pageId: PAGE,
    formId: FORM,
    confirmedAt: CONFIRMED_AT.toISOString(),
    eligible: [{ sourceEventId: "a", fingerprint: "zzzz" }],
  });
  assert.equal(left, right);
  assert.notEqual(left, changed);
});

test("the preview payload rejects sensitive keys", () => {
  const preview = assembleCorrectionPreview({
    sourceFunnelId: "funnel_1",
    pageId: PAGE,
    formId: FORM,
    originClientAccountId: "jr_laird",
    providerFunnelId: `fbpage:${PAGE}:fbform:${FORM}`,
    confirmedAt: CONFIRMED_AT.toISOString(),
    cohort: cohort(),
    events: [classify()],
    verificationCode: null,
    decision: "all",
    limit: 25,
    offset: 0,
    includeAllowList: false,
    issuedAt: new Date("2026-11-09T15:00:00.000Z"),
  });
  assert.doesNotThrow(() => assertPreviewHasNoSensitiveKeys(preview));
  assert.throws(() => assertPreviewHasNoSensitiveKeys({ email: "person@example.test" }));
  assert.equal(JSON.stringify(preview).includes("\"sourceLeadId\""), false);
  assert.equal(JSON.stringify(preview).includes("\"rawPayloadJson\""), false);
});

test("the preview service stays read-only and raises only its own transaction budget", () => {
  const source = readFileSync(
    new URL("./facebook-association-correction-preview.service.ts", import.meta.url),
    "utf8"
  );
  assert.equal(source.includes("reevaluateFacebookCaptureAssociation"), false);
  assert.equal(source.includes("company-sheets"), false);
  assert.equal(source.includes("ghl-live"), false);
  assert.equal(source.includes("graph.facebook.com"), false);
  const readOnly = source.indexOf("SET TRANSACTION READ ONLY");
  const statementTimeout = source.indexOf("set_config('statement_timeout'");
  assert.ok(readOnly > -1);
  assert.ok(statementTimeout > readOnly);
  assert.match(source, /timeout:\s*PREVIEW_TRANSACTION_TIMEOUT_MS/);
  assert.equal(PREVIEW_TRANSACTION_TIMEOUT_MS, 15_000);
  assert.equal(PREVIEW_TRANSACTION_MAX_WAIT_MS, 2_000);
  assert.equal(PREVIEW_STATEMENT_TIMEOUT_MS, 12_000);
  assert.ok(PREVIEW_STATEMENT_TIMEOUT_MS < PREVIEW_TRANSACTION_TIMEOUT_MS);
});

test("a closed preview transaction returns no allow-list", async () => {
  const db = {
    async $transaction() {
      throw new Prisma.PrismaClientKnownRequestError(
        "Transaction already closed: The timeout for this transaction was 15000 ms, however 15010 ms passed since the start of the transaction.",
        { code: "P2028", clientVersion: "test" }
      );
    },
  } as unknown as PrismaClient;
  let returned: unknown = "not-returned";
  await assert.rejects(
    async () => {
      returned = await loadFacebookAssociationCorrectionPreview(
        {
          sourceFunnelId: "funnel_1",
          pageId: PAGE,
          formId: FORM,
          originClientAccountId: "jr_laird",
          confirmedAt: CONFIRMED_AT,
          limit: 25,
          offset: 0,
          decision: "all",
          includeAllowList: true,
        },
        db
      );
    },
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028"
  );
  assert.equal(returned, "not-returned");
});
