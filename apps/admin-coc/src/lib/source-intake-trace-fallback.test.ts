import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readAdminApiErrorCode } from "./admin-api/admin-api-error.ts";
import {
  LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
  isApplicableSourceIntakeTrace,
  resolveLeadTimelineSurface,
  selectSingleSourceIntakeAnchor,
  shouldUseSourceIntakeTraceFallback,
} from "./source-intake-trace-fallback.ts";

const leadcaptureTrace = {
  webhookRequestLog: { source: "leadcapture_io" },
  sourceLeadEvent: { sourceProvider: "leadcapture_io" },
};

const ghlTrace = {
  webhookRequestLog: { source: "ghl_lifecycle" },
  sourceLeadEvent: null,
};

test("source intake fallback accepts only the scope-unresolved 400", () => {
  assert.equal(
    shouldUseSourceIntakeTraceFallback({
      timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
      httpStatus: 400,
    }),
    true
  );
  assert.equal(
    shouldUseSourceIntakeTraceFallback({
      timelineErrorCode: "invalid_query",
      httpStatus: 400,
    }),
    false
  );
  assert.equal(
    shouldUseSourceIntakeTraceFallback({
      timelineErrorCode: "missing_anchor",
      httpStatus: 400,
    }),
    false
  );
  assert.equal(
    shouldUseSourceIntakeTraceFallback({
      timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
      httpStatus: 500,
    }),
    false
  );
  for (const httpStatus of [401, 403, 502, 503]) {
    assert.equal(
      shouldUseSourceIntakeTraceFallback({
        timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
        httpStatus,
      }),
      false
    );
  }
});

test("full-page and compact surfaces keep ordinary errors and accept one applicable trace", () => {
  const scopeError = "Could not resolve lead scope.";
  const replaced = resolveLeadTimelineSurface({
    timeline: null,
    timelineError: scopeError,
    timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
    timelineHttpStatus: 400,
    trace: leadcaptureTrace,
  });
  assert.equal(replaced.timelineError, null);
  assert.equal(replaced.trace, leadcaptureTrace);

  const ghl = resolveLeadTimelineSurface({
    timeline: null,
    timelineError: scopeError,
    timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
    timelineHttpStatus: 400,
    trace: ghlTrace,
  });
  assert.equal(ghl.timelineError, scopeError);
  assert.equal(ghl.trace, null);
  assert.equal(isApplicableSourceIntakeTrace(ghlTrace), false);

  const serverError = resolveLeadTimelineSurface({
    timeline: null,
    timelineError: "Admin API error (500): upstream failed",
    timelineErrorCode: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE,
    timelineHttpStatus: 500,
    trace: leadcaptureTrace,
  });
  assert.match(serverError.timelineError ?? "", /500/);
  assert.equal(serverError.trace, null);

  const unrelated = resolveLeadTimelineSurface({
    timeline: null,
    timelineError: "Admin API error (400): Invalid query",
    timelineErrorCode: "invalid_query",
    timelineHttpStatus: 400,
    trace: leadcaptureTrace,
  });
  assert.match(unrelated.timelineError ?? "", /Invalid query/);
  assert.equal(unrelated.trace, null);

  const timelineWins = resolveLeadTimelineSurface({
    timeline: { ok: true },
    timelineError: null,
    timelineErrorCode: null,
    timelineHttpStatus: 200,
    trace: leadcaptureTrace,
  });
  assert.equal(timelineWins.trace, null);
  assert.deepEqual(timelineWins.timelineError, null);
});

test("lookup anchors stay singular", () => {
  assert.deepEqual(selectSingleSourceIntakeAnchor({ requestId: "log_1" }), {
    kind: "one",
    anchor: { webhookRequestLogId: "log_1" },
  });
  assert.deepEqual(
    selectSingleSourceIntakeAnchor({ webhookRequestLogId: "log_1", requestId: "log_1" }),
    { kind: "one", anchor: { webhookRequestLogId: "log_1" } }
  );
  assert.equal(
    selectSingleSourceIntakeAnchor({ requestId: "log_1", sourceLeadId: "lead_2" }).kind,
    "conflict"
  );
  assert.equal(selectSingleSourceIntakeAnchor({}).kind, "none");
});

test("error code reader ignores free text and the page and widget share the decision", () => {
  assert.equal(
    readAdminApiErrorCode(
      JSON.stringify({ ok: false, code: LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE, error: "scope" })
    ),
    LEAD_TIMELINE_SCOPE_UNRESOLVED_CODE
  );
  assert.equal(readAdminApiErrorCode("Could not resolve lead scope. Provide requestId"), null);
  assert.equal(readAdminApiErrorCode(JSON.stringify({ code: "Buyer@secret.example" })), null);
  assert.equal(readAdminApiErrorCode("<html>500</html>"), null);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(path.join(here, "../app/(dashboard)/lead-timeline/page.tsx"), "utf8");
  const compact = readFileSync(
    path.join(here, "../components/dashboard/lead-timeline-compact.tsx"),
    "utf8"
  );
  assert.match(page, /resolveLeadTimelineSurface/);
  assert.match(compact, /resolveLeadTimelineSurface/);
  assert.match(page, /shouldUseSourceIntakeTraceFallback/);
  assert.match(compact, /shouldUseSourceIntakeTraceFallback/);
  assert.doesNotMatch(compact, /requestId:\s*anchor\.requestId/);
});
