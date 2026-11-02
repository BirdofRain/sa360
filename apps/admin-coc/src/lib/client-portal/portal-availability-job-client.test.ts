import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PORTAL_AVAILABILITY_BUSY_MESSAGE,
  PORTAL_AVAILABILITY_EXPIRED_MESSAGE,
  loadPortalInventoryAvailabilityThroughJob,
} from "./portal-availability-job-client.ts";

const availability = {
  ok: true as const,
  evaluatedAt: "2026-10-30T21:00:00.000Z",
  stale: false,
  mappingSupported: true,
  mappingNote: "ready",
  lookupStatus: "ready" as const,
  criteria: {
    nicheKey: "trucker",
    requestedAgeBucket: "COMMERCE_12_MO_PLUS" as const,
    requestedQuantity: 25,
  },
  states: [{ state: "TX", availability: "Available" as const }],
};

test("portal availability polling returns the map only after the job completes", async () => {
  const previous = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/jobs")) {
      return new Response(
        JSON.stringify({ ok: true, status: "running", jobId: "bav_33333333-3333-3333-3333-333333333333" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    polls += 1;
    if (polls === 1) {
      return new Response(
        JSON.stringify({
          ok: true,
          status: "running",
          progress: {
            phase: "classifying",
            rowsClassified: 500,
            selectableRowsExact: 12000,
            pagesRead: 2,
          },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true, status: "complete", availability }), { status: 200 });
  }) as typeof fetch;
  try {
    let seen = "";
    const result = await loadPortalInventoryAvailabilityThroughJob({
      nicheKey: "trucker",
      requestedAgeBucket: "COMMERCE_12_MO_PLUS",
      requestedQuantity: 25,
      signal: new AbortController().signal,
      onProgress: (progress) => {
        seen = `${progress.rowsClassified}/${progress.selectableRowsExact}`;
      },
    });
    assert.equal(seen, "500/12000");
    assert.equal(result.states[0]?.availability, "Available");
    assert.equal(result.mappingSupported, true);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a cancelled portal job does not become an availability map", async () => {
  const previous = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const url = String(input);
    if (url.endsWith("/jobs")) {
      return new Response(
        JSON.stringify({ ok: true, status: "running", jobId: "bav_44444444-4444-4444-4444-444444444444" }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true, status: "cancelled" }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        loadPortalInventoryAvailabilityThroughJob({
          nicheKey: "trucker",
          requestedAgeBucket: "COMMERCE_12_MO_PLUS",
          requestedQuantity: 25,
          signal: new AbortController().signal,
        }),
      /temporarily unavailable/
    );
    assert.equal(methods.includes("DELETE"), false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a busy portal count explains itself and an expired job is not a map", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ ok: false, code: "availability_job_busy" }),
      { status: 503 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        loadPortalInventoryAvailabilityThroughJob({
          nicheKey: "trucker",
          requestedAgeBucket: "COMMERCE_12_MO_PLUS",
          requestedQuantity: 25,
          signal: new AbortController().signal,
        }),
      new RegExp(PORTAL_AVAILABILITY_BUSY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    globalThis.fetch = previous;
  }

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/jobs")) {
      return new Response(
        JSON.stringify({ ok: true, status: "running", jobId: "bav_55555555-5555-5555-5555-555555555555" }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ ok: false, code: "availability_job_expired" }),
      { status: 409 }
    );
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        loadPortalInventoryAvailabilityThroughJob({
          nicheKey: "trucker",
          requestedAgeBucket: "COMMERCE_12_MO_PLUS",
          requestedQuantity: 25,
          signal: new AbortController().signal,
        }),
      new RegExp(PORTAL_AVAILABILITY_EXPIRED_MESSAGE.slice(0, 24))
    );
  } finally {
    globalThis.fetch = previous;
  }
});
