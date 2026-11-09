import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalConfirmationSnapshot,
  CONFIRMATION_ACKNOWLEDGEMENT,
  CONFIRMATION_SNAPSHOT_SECRET_ENV,
  CONFIRMATION_SNAPSHOT_TTL_MS,
  ConfirmationSnapshotError,
  readConfirmationSnapshotSecret,
  signConfirmationCanonical,
  signConfirmationSnapshot,
  verifyConfirmationSnapshot,
  type ConfirmationExpectation,
  type ConfirmationSnapshotEvent,
  type SignedConfirmationSnapshot,
} from "./facebook-association-correction-confirmation.js";

const SECRET = "confirmation-snapshot-test-secret-32";
const OTHER_SECRET = "confirmation-snapshot-other-secret-32";
const NOW = new Date("2026-11-09T15:54:27.000Z");
const DIGEST = "a".repeat(64);

const EVENTS: ConfirmationSnapshotEvent[] = [
  { sourceEventId: "event_b", fingerprint: "bbbbbbbbbbbbbbbb" },
  { sourceEventId: "event_a", fingerprint: "aaaaaaaaaaaaaaaa" },
];

function signed(events: ConfirmationSnapshotEvent[] = EVENTS, now = NOW): SignedConfirmationSnapshot {
  return signConfirmationSnapshot({
    sourceFunnelId: "funnel_1",
    pageId: "222591640945329",
    formId: "1977370106440985",
    originClientAccountId: "jr_laird",
    confirmedAt: "2026-10-27T14:25:02.000Z",
    previewDigest: DIGEST,
    events,
    acknowledgement: CONFIRMATION_ACKNOWLEDGEMENT,
    secret: SECRET,
    now,
  });
}

function expected(events: ConfirmationSnapshotEvent[] = signed().body.events): ConfirmationExpectation {
  return {
    sourceFunnelId: "funnel_1",
    pageId: "222591640945329",
    formId: "1977370106440985",
    originClientAccountId: "jr_laird",
    confirmedAt: "2026-10-27T14:25:02.000Z",
    previewDigest: DIGEST,
    events,
    acknowledgement: CONFIRMATION_ACKNOWLEDGEMENT,
  };
}

test("a signed snapshot matches the sorted eligible set and can be verified twice", () => {
  const snapshot = signed();
  assert.deepEqual(
    snapshot.body.events.map((event) => event.sourceEventId),
    ["event_a", "event_b"]
  );
  assert.equal(snapshot.body.eventCount, 2);
  assert.equal(snapshot.body.acknowledgement, "association_only");
  assert.equal(Date.parse(snapshot.body.expiresAt) - Date.parse(snapshot.body.issuedAt), CONFIRMATION_SNAPSHOT_TTL_MS);
  const before = JSON.stringify(snapshot);
  const first = verifyConfirmationSnapshot({ snapshot, secret: SECRET, now: NOW, expected: expected() });
  const second = verifyConfirmationSnapshot({ snapshot, secret: SECRET, now: NOW, expected: expected() });
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(snapshot), before);
});

test("canonical serialization is stable and does not accept the unsigned digest", () => {
  const snapshot = signed();
  assert.equal(canonicalConfirmationSnapshot(snapshot.body), canonicalConfirmationSnapshot(snapshot.body));
  assert.equal(canonicalConfirmationSnapshot(snapshot.body).includes("\n"), false);
  const digestOnly = verifyConfirmationSnapshot({
    snapshot: DIGEST,
    secret: SECRET,
    now: NOW,
    expected: expected(),
  });
  assert.deepEqual(digestOnly, { ok: false, code: "malformed" });
});

test("reordered events and a substituted event id fail closed", () => {
  const snapshot = signed();
  const reordered: SignedConfirmationSnapshot = {
    ...snapshot,
    body: { ...snapshot.body, events: [...snapshot.body.events].reverse() },
  };
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot: reordered, secret: SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "not_canonical" }
  );
  const tampered: SignedConfirmationSnapshot = {
    ...snapshot,
    body: {
      ...snapshot.body,
      events: snapshot.body.events.map((event, index) =>
        index === 0 ? { ...event, sourceEventId: "event_aa" } : event
      ),
    },
  };
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot: tampered, secret: SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "invalid_signature" }
  );
});

test("a signed set that adds or drops an event does not match the expected set", () => {
  const snapshot = signed();
  const missing = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: expected([snapshot.body.events[0]!]),
  });
  assert.deepEqual(missing, { ok: false, code: "event_set_mismatch" });
  const extra = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: expected([
      ...snapshot.body.events,
      { sourceEventId: "event_c", fingerprint: "cccccccccccccccc" },
    ]),
  });
  assert.deepEqual(extra, { ok: false, code: "event_set_mismatch" });
  const counted = {
    ...snapshot,
    body: { ...snapshot.body, eventCount: 1 },
  };
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot: counted, secret: SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "count_mismatch" }
  );
});

test("owner, funnel, page, form, and fingerprint bindings are exact", () => {
  const snapshot = signed();
  const owner = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: { ...expected(), originClientAccountId: "other_client" },
  });
  assert.deepEqual(owner, { ok: false, code: "cohort_mismatch" });
  const funnel = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: { ...expected(), sourceFunnelId: "funnel_2" },
  });
  assert.deepEqual(funnel, { ok: false, code: "cohort_mismatch" });
  const page = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: { ...expected(), pageId: "333333333333333" },
  });
  assert.deepEqual(page, { ok: false, code: "cohort_mismatch" });
  const fingerprint = verifyConfirmationSnapshot({
    snapshot,
    secret: SECRET,
    now: NOW,
    expected: expected([
      { sourceEventId: "event_a", fingerprint: "aaaaaaaaaaaaaaab" },
      snapshot.body.events[1]!,
    ]),
  });
  assert.deepEqual(fingerprint, { ok: false, code: "fingerprint_mismatch" });
});

test("expired, future-issued, wrong acknowledgement, unknown version, and bad signatures are rejected", () => {
  const snapshot = signed();
  assert.deepEqual(
    verifyConfirmationSnapshot({
      snapshot,
      secret: SECRET,
      now: new Date(Date.parse(snapshot.body.expiresAt)),
      expected: expected(),
    }),
    { ok: false, code: "expired" }
  );
  assert.deepEqual(
    verifyConfirmationSnapshot({
      snapshot,
      secret: SECRET,
      now: new Date(NOW.getTime() - 1),
      expected: expected(),
    }),
    { ok: false, code: "issued_in_future" }
  );
  assert.deepEqual(
    verifyConfirmationSnapshot({
      snapshot,
      secret: SECRET,
      now: NOW,
      expected: { ...expected(), acknowledgement: "deliver_now" as typeof CONFIRMATION_ACKNOWLEDGEMENT },
    }),
    { ok: false, code: "acknowledgement_rejected" }
  );
  const wrongAck = {
    ...snapshot.body,
    acknowledgement: "deliver_now",
  };
  const signedWrongAck = {
    body: wrongAck,
    signature: signConfirmationCanonical(canonicalConfirmationSnapshot(wrongAck as never), SECRET),
  };
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot: signedWrongAck, secret: SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "acknowledgement_rejected" }
  );
  const unknown = { ...snapshot.body, v: 2 };
  const signedUnknown = {
    body: unknown,
    signature: signConfirmationCanonical(JSON.stringify(unknown), SECRET),
  };
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot: signedUnknown, secret: SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "unknown_version" }
  );
  const flipped = `${snapshot.signature.slice(0, -1)}${snapshot.signature.endsWith("a") ? "b" : "a"}`;
  assert.deepEqual(
    verifyConfirmationSnapshot({
      snapshot: { ...snapshot, signature: flipped },
      secret: SECRET,
      now: NOW,
      expected: expected(),
    }),
    { ok: false, code: "invalid_signature" }
  );
  assert.deepEqual(
    verifyConfirmationSnapshot({ snapshot, secret: OTHER_SECRET, now: NOW, expected: expected() }),
    { ok: false, code: "invalid_signature" }
  );
});

test("signing refuses a short secret, the admin key, and a non-association acknowledgement", () => {
  assert.equal(
    readConfirmationSnapshotSecret({
      [CONFIRMATION_SNAPSHOT_SECRET_ENV]: SECRET,
      ADMIN_API_KEY: "admin-key-should-not-be-used",
    }),
    SECRET
  );
  assert.equal(
    readConfirmationSnapshotSecret({ ADMIN_API_KEY: "admin-key-should-not-be-used-32" }),
    null
  );
  assert.throws(
    () => signed(EVENTS, NOW) && signConfirmationSnapshot({
      ...expected(),
      events: EVENTS,
      acknowledgement: CONFIRMATION_ACKNOWLEDGEMENT,
      secret: "too-short",
      now: NOW,
    }),
    (error: unknown) => error instanceof ConfirmationSnapshotError && error.code === "secret_unavailable" && !String(error).includes("too-short")
  );
  assert.throws(
    () =>
      signConfirmationSnapshot({
        ...expected(),
        events: EVENTS,
        acknowledgement: "execute_delivery",
        secret: SECRET,
        now: NOW,
      }),
    (error: unknown) => error instanceof ConfirmationSnapshotError && error.code === "acknowledgement_rejected"
  );
});

test("the confirmation module does not reach a database, delivery, Graph, routing, or reevaluation", () => {
  const source = readFileSync(new URL("./facebook-association-correction-confirmation.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "prisma",
    "$transaction",
    "reevaluateFacebookCaptureAssociation",
    "graph.facebook.com",
    "company-sheets",
    "ghl-live",
    "ADMIN_API_KEY",
    "SA360_ADMIN_KEY",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
