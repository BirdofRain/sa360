import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySourceResolutionGroup,
  emptyOutcomeCounts,
  explainUnstampedGroup,
  facebookAssociationIdFilter,
  type SourceResolutionOwner,
} from "./facebook-source-resolution-review.js";

const owner = (clientAccountId: string): SourceResolutionOwner => ({
  sourceFunnelId: `funnel_${clientAccountId}`,
  originClientAccountId: clientAccountId,
  createdAt: new Date("2026-11-01T15:00:00.000Z"),
  updatedAt: new Date("2026-11-02T15:00:00.000Z"),
});

test("missing page and form cannot be identified", () => {
  const result = classifySourceResolutionGroup({
    pageId: null,
    formId: null,
    unresolvedEvents: 2,
    owners: [owner("client_a")],
  });
  assert.equal(result.classification, "cannot_identify");
  assert.equal(result.confirmedOriginClientAccountId, null);
});

test("a confirmed owner with unresolved events stays unstamped", () => {
  const result = classifySourceResolutionGroup({
    pageId: "222591640945329",
    formId: "1977370106440985",
    unresolvedEvents: 81,
    owners: [owner("jr_laird")],
  });
  assert.equal(result.classification, "unstamped_confirmed_owner");
  assert.equal(result.confirmedOriginClientAccountId, "jr_laird");
  assert.equal(result.confirmedSourceFunnelId, "funnel_jr_laird");
});

test("numeric page and form without an owner is unknown", () => {
  const result = classifySourceResolutionGroup({
    pageId: "489524397576648",
    formId: "1432591247777562",
    unresolvedEvents: 3,
    owners: [],
  });
  assert.equal(result.classification, "unknown_ownership");
});

test("two confirmed owners are ambiguous and name neither client", () => {
  const result = classifySourceResolutionGroup({
    pageId: "102720336121632",
    formId: "1149211490298917",
    unresolvedEvents: 1,
    owners: [owner("client_a"), owner("client_b")],
  });
  assert.equal(result.classification, "ambiguous_owner");
  assert.equal(result.confirmedOriginClientAccountId, null);
});

test("unstamped explanations follow the stored settlement outcome", () => {
  const unassociated = emptyOutcomeCounts();
  unassociated.unassociated = 81;
  assert.match(
    explainUnstampedGroup({ classification: "unstamped_confirmed_owner", outcomes: unassociated }),
    /recorded unassociated/
  );
  const disabled = emptyOutcomeCounts();
  disabled.association_disabled = 4;
  assert.match(
    explainUnstampedGroup({ classification: "unstamped_confirmed_owner", outcomes: disabled }),
    /association_disabled/
  );
  const mixed = emptyOutcomeCounts();
  mixed.unassociated = 2;
  mixed.association_disabled = 1;
  assert.match(
    explainUnstampedGroup({ classification: "unstamped_confirmed_owner", outcomes: mixed }),
    /mixed or empty/
  );
  assert.match(
    explainUnstampedGroup({ classification: "cannot_identify", outcomes: emptyOutcomeCounts() }),
    /cannot be matched/
  );
});

test("association lookup keeps a form-only filter", () => {
  assert.deepEqual(facebookAssociationIdFilter({ pageId: null, formId: "1977370106440985" }), {
    kind: "form",
    prefix: "fbpage:",
    suffix: ":fbform:1977370106440985",
  });
  assert.deepEqual(facebookAssociationIdFilter({ pageId: "222591640945329", formId: null }), {
    kind: "page",
    prefix: "fbpage:222591640945329:fbform:",
  });
  assert.deepEqual(
    facebookAssociationIdFilter({ pageId: "222591640945329", formId: "1977370106440985" }),
    {
      kind: "exact",
      providerFunnelId: "fbpage:222591640945329:fbform:1977370106440985",
    }
  );
  assert.deepEqual(facebookAssociationIdFilter({ pageId: null, formId: null }), {
    kind: "all",
    prefix: "fbpage:",
  });
});
