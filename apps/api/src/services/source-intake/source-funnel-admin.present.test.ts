import assert from "node:assert/strict";
import test from "node:test";

import type { SourceFunnel } from "@prisma/client";

import {
  compareSourceFunnelsForClientList,
  presentSourceFunnelAdmin,
  sortSourceFunnelsForClientList,
} from "./source-funnel-admin.present.js";

function funnel(partial: Partial<SourceFunnel> & { id: string }): SourceFunnel {
  return {
    provider: "leadcapture_io",
    providerFunnelId: null,
    parentUrlKey: `my.leadcapture.io/p/${partial.id}`,
    pageSlug: partial.id,
    observedFunnelName: null,
    nicheKey: null,
    associationStatus: "confirmed",
    suggestedClientAccountId: null,
    originClientAccountId: "client_a",
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...partial,
  };
}

test("presentSourceFunnelAdmin serializes dates and keeps null firstSeenAt", () => {
  const row = funnel({
    id: "sf_1",
    firstSeenAt: null,
    lastSeenAt: new Date("2026-09-10T15:00:00.000Z"),
    observedFunnelName: "Life Insurance For Veterans - Madison Pimentel V2",
    nicheKey: "vet_fex",
  });
  const dto = presentSourceFunnelAdmin(row);
  assert.equal(dto.id, "sf_1");
  assert.equal(dto.provider, "leadcapture_io");
  assert.equal(dto.firstSeenAt, null);
  assert.equal(dto.lastSeenAt, "2026-09-10T15:00:00.000Z");
  assert.equal(dto.observedFunnelName, "Life Insurance For Veterans - Madison Pimentel V2");
  assert.equal(dto.providerFunnelId, null);
});

test("sort puts confirmed before suggested, observed before pre-registered, newest lastSeen first", () => {
  const suggestedRecent = funnel({
    id: "sugg_new",
    associationStatus: "suggested",
    originClientAccountId: null,
    suggestedClientAccountId: "client_a",
    firstSeenAt: new Date("2026-09-10T00:00:00.000Z"),
    lastSeenAt: new Date("2026-09-10T12:00:00.000Z"),
  });
  const confirmedOld = funnel({
    id: "conf_old",
    firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  const confirmedNew = funnel({
    id: "conf_new",
    firstSeenAt: new Date("2026-09-08T00:00:00.000Z"),
    lastSeenAt: new Date("2026-09-10T18:00:00.000Z"),
  });
  const prereg = funnel({
    id: "prereg",
    firstSeenAt: null,
    lastSeenAt: null,
  });
  const sorted = sortSourceFunnelsForClientList([
    suggestedRecent,
    prereg,
    confirmedOld,
    confirmedNew,
  ]);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["conf_new", "conf_old", "prereg", "sugg_new"]
  );
  assert.ok(compareSourceFunnelsForClientList(confirmedNew, confirmedOld) < 0);
});
