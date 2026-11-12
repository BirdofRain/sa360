import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SESSION_SECRET = "admin-coc-session-secret-32b";

function order(id: string, status: string, payment: string) {
  return {
    id,
    orderNumber: `LO-${id}`,
    clientAccountId: "acct_1",
    clientDisplayName: "Northwind",
    status,
    nicheKey: "Solar",
    states: ["TX"],
    leadVolume: 25,
    campaignType: "Aged leads",
    crmPackage: "GHL",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "GHL",
    createdAt: "2026-10-21T12:00:00.000Z",
    submittedAt: "2026-10-21T12:00:00.000Z",
    paymentConfirmationStatus: payment,
  };
}

function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(previous: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in previous)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}

test("orders awaiting action counts every page and ignores approved orders", async () => {
  const { loadOrdersAwaitingOperatorAction } = await import("./attention-queue.ts");
  const pages: Array<string | undefined> = [];
  const read = await loadOrdersAwaitingOperatorAction({
    readAccess: async () => ({ kind: "admin", source: "shared_password" }),
    loadOrders: async () => {
      const { loadCocLeadOrders } = await import("../coc-orders/load-coc-lead-orders.ts");
      return loadCocLeadOrders(async (params) => {
        pages.push(params?.cursor);
        if (!params?.cursor) {
          return {
            items: [
              order("p1", "submitted", "pending_confirmation"),
              order("ready", "ready", "confirmed"),
              order("active", "active", "confirmed"),
            ],
            nextCursor: "cursor-2",
            error: null,
          };
        }
        return {
          items: [
            order("p2-confirmed", "submitted", "confirmed"),
            order("p2-comp", "submitted", "not_required"),
          ],
          nextCursor: null,
          error: null,
        };
      }, () => true);
    },
  });
  assert.deepEqual(pages, [undefined, "cursor-2"]);
  assert.deepEqual(read, { state: "ready", count: 3 });
});

test("a successful empty orders read is zero, and a failed or truncated read is not", async () => {
  const { loadOrdersAwaitingOperatorAction } = await import("./attention-queue.ts");
  const admin = async () => ({ kind: "admin", source: "shared_password" }) as const;
  const empty = await loadOrdersAwaitingOperatorAction({
    readAccess: admin,
    loadOrders: async () => ({ orders: [], error: null, configured: true, truncated: false }),
  });
  assert.deepEqual(empty, { state: "ready", count: 0 });

  const failed = await loadOrdersAwaitingOperatorAction({
    readAccess: admin,
    loadOrders: async () => ({
      orders: [],
      error: "Admin API error (503): unavailable",
      configured: true,
      truncated: false,
    }),
  });
  assert.equal(failed.state, "unavailable");
  if (failed.state === "unavailable") assert.match(failed.reason, /unavailable/);

  const truncated = await loadOrdersAwaitingOperatorAction({
    readAccess: admin,
    loadOrders: async () => ({
      orders: [
        {
          id: "ord_1",
          orderNumber: "LO-1",
          clientName: "Northwind",
          niche: "Solar",
          states: ["TX"],
          state: "TX",
          volume: 1,
          campaignType: "Aged leads",
          crmPackage: "GHL",
          aiVoiceAddon: false,
          deliveryDestination: "GHL",
          status: "submitted",
          adminStatus: "submitted",
          paymentConfirmationStatus: "pending_confirmation",
          createdAt: "2026-10-21T12:00:00.000Z",
        },
      ],
      error: null,
      configured: true,
      truncated: true,
    }),
  });
  assert.equal(truncated.state, "unavailable");
  if (truncated.state === "unavailable") assert.match(truncated.reason, /incomplete/);
});

test("source intake awaiting review sums every page of needs_review", async () => {
  const { loadSourceIntakeAwaitingReview } = await import("./attention-queue.ts");
  const calls: Record<string, string>[] = [];
  const read = await loadSourceIntakeAwaitingReview({
    readAccess: async () => ({ kind: "observer" }),
    configured: () => true,
    fetchPage: async (params) => {
      calls.push(params);
      if (!params.cursor) {
        return { items: Array.from({ length: 200 }, (_, i) => ({ id: `a-${i}` })), nextCursor: "c2", error: null };
      }
      if (params.cursor === "c2") {
        return { items: [{ id: "b-1" }, { id: "b-2" }], nextCursor: "c3", error: null };
      }
      return { items: [{ id: "c-1" }], nextCursor: null, error: null };
    },
  });
  assert.equal(calls.every((params) => params.status === "needs_review"), true);
  assert.deepEqual(
    calls.map((params) => params.cursor ?? null),
    [null, "c2", "c3"]
  );
  assert.deepEqual(read, { state: "ready", count: 203 });
});

test("source intake shows zero only after a complete empty read", async () => {
  const { loadSourceIntakeAwaitingReview } = await import("./attention-queue.ts");
  const admin = async () => ({ kind: "admin", source: "shared_password" }) as const;
  let unconfiguredCalls = 0;
  const unconfigured = await loadSourceIntakeAwaitingReview({
    readAccess: admin,
    configured: () => false,
    fetchPage: async () => {
      unconfiguredCalls += 1;
      return { items: [], nextCursor: null, error: null };
    },
  });
  assert.equal(unconfigured.state, "unavailable");
  assert.equal(unconfiguredCalls, 0);

  const empty = await loadSourceIntakeAwaitingReview({
    readAccess: admin,
    configured: () => true,
    fetchPage: async () => ({ items: [], nextCursor: null, error: null }),
  });
  assert.deepEqual(empty, { state: "ready", count: 0 });

  let calls = 0;
  const failedLater = await loadSourceIntakeAwaitingReview({
    readAccess: admin,
    configured: () => true,
    fetchPage: async (params) => {
      calls += 1;
      if (!params.cursor) return { items: [{ id: "a" }, { id: "b" }], nextCursor: "c2", error: null };
      return { items: [], nextCursor: null, error: "Admin API error (503): unavailable" };
    },
  });
  assert.equal(calls, 2);
  assert.equal(failedLater.state, "unavailable");

  const repeated = await loadSourceIntakeAwaitingReview({
    readAccess: admin,
    configured: () => true,
    fetchPage: async () => ({ items: [{ id: "a" }], nextCursor: "same", error: null }),
  });
  assert.equal(repeated.state, "unavailable");
});

test("administrator can read both queues and workspace or observer follow existing gates", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SESSION_SECRET;
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const staff = await import("../staff-admin-coc-access.ts");
  const { loadOrdersAwaitingOperatorAction, loadSourceIntakeAwaitingReview } = await import(
    "./attention-queue.ts"
  );
  let orderFetches = 0;
  let sourceFetches = 0;
  const loadOrders = async () => {
    orderFetches += 1;
    return { orders: [], error: null, configured: true, truncated: false };
  };
  const fetchPage = async () => {
    sourceFetches += 1;
    return { items: [], nextCursor: null, error: null };
  };
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("admin");
    const staffOrders = await loadOrdersAwaitingOperatorAction({ loadOrders });
    const staffSource = await loadSourceIntakeAwaitingReview({
      fetchPage,
      configured: () => true,
    });
    assert.deepEqual(staffOrders, { state: "ready", count: 0 });
    assert.deepEqual(staffSource, { state: "ready", count: 0 });
    assert.equal(orderFetches, 1);
    assert.equal(sourceFetches, 1);

    orderFetches = 0;
    sourceFetches = 0;
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_manager"],
      staffPrincipalId: "c123456789012345678901234",
    });
    const managerOrders = await loadOrdersAwaitingOperatorAction({ loadOrders });
    const managerSource = await loadSourceIntakeAwaitingReview({
      fetchPage,
      configured: () => true,
    });
    assert.equal(managerOrders.state, "unavailable");
    assert.equal(managerSource.state, "unavailable");
    assert.equal(orderFetches, 0);
    assert.equal(sourceFetches, 0);

    staff.useStaffCapabilitiesTestResult(undefined);
    const observerCookie = session.createAdminCocSessionToken(undefined, SESSION_SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observerCookie ?? undefined);
    const observerOrders = await loadOrdersAwaitingOperatorAction({ loadOrders });
    const observerSource = await loadSourceIntakeAwaitingReview({
      fetchPage,
      configured: () => true,
    });
    assert.equal(observerOrders.state, "unavailable");
    assert.equal(observerSource.state, "ready");
    assert.equal(orderFetches, 0);
    assert.equal(sourceFetches, 1);
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    restoreEnv(previous);
  }
});

test("delivery failures count only the current delivery_failed pages", async () => {
  const { loadDeliveryFailuresRequiringAction } = await import("./attention-queue.ts");
  const calls: Record<string, string>[] = [];
  const refreshedAt = "2026-01-15T15:30:00.000Z";
  const read = await loadDeliveryFailuresRequiringAction({
    readAccess: async () => ({ kind: "admin", source: "shared_password" }),
    configured: () => true,
    now: () => new Date(refreshedAt),
    fetchPage: async (params) => {
      calls.push(params);
      if (!params.cursor) {
        return { items: [{ id: "fail-1" }, { id: "fail-2" }], nextCursor: "c2", error: null };
      }
      return { items: [{ id: "fail-3" }], nextCursor: null, error: null };
    },
  });
  assert.equal(calls.every((params) => params.status === "delivery_failed"), true);
  assert.equal(calls.every((params) => params.limit === "200"), true);
  assert.equal(
    calls.some((params) => "receivedFrom" in params || "from" in params || "to" in params || "includeCleanup" in params),
    false
  );
  assert.deepEqual(
    calls.map((params) => params.cursor ?? null),
    [null, "c2"]
  );
  assert.deepEqual(read, { state: "ready", count: 3, refreshedAt });
});

test("delivery failures are zero only after a complete empty read", async () => {
  const { loadDeliveryFailuresRequiringAction } = await import("./attention-queue.ts");
  const admin = async () => ({ kind: "admin", source: "shared_password" }) as const;
  const refreshedAt = "2026-07-15T16:00:00.000Z";
  let unconfiguredCalls = 0;
  const unconfigured = await loadDeliveryFailuresRequiringAction({
    readAccess: admin,
    configured: () => false,
    now: () => new Date(refreshedAt),
    fetchPage: async () => {
      unconfiguredCalls += 1;
      return { items: [], nextCursor: null, error: null };
    },
  });
  assert.equal(unconfigured.state, "unavailable");
  assert.equal("refreshedAt" in unconfigured, false);
  assert.equal(unconfiguredCalls, 0);

  const empty = await loadDeliveryFailuresRequiringAction({
    readAccess: admin,
    configured: () => true,
    now: () => new Date(refreshedAt),
    fetchPage: async () => ({ items: [], nextCursor: null, error: null }),
  });
  assert.deepEqual(empty, { state: "ready", count: 0, refreshedAt });

  const failed = await loadDeliveryFailuresRequiringAction({
    readAccess: admin,
    configured: () => true,
    now: () => new Date(refreshedAt),
    fetchPage: async () => ({ items: [{ id: "fail-1" }], nextCursor: null, error: "Admin API error (503): unavailable" }),
  });
  assert.equal(failed.state, "unavailable");
  assert.equal("refreshedAt" in failed, false);
  if (failed.state === "unavailable") assert.match(failed.reason, /unavailable/);

  const repeated = await loadDeliveryFailuresRequiringAction({
    readAccess: admin,
    configured: () => true,
    fetchPage: async () => ({ items: [{ id: "fail-1" }], nextCursor: "same", error: null }),
  });
  assert.equal(repeated.state, "unavailable");
  if (repeated.state === "unavailable") assert.match(repeated.reason, /delivery failure count/);
});

test("delivery failures follow the source intake permission gate", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SESSION_SECRET;
  const session = await import("../admin-coc-session.ts");
  const guard = await import("../admin-coc-session-guard.ts");
  const staff = await import("../staff-admin-coc-access.ts");
  const { loadDeliveryFailuresRequiringAction } = await import("./attention-queue.ts");
  let fetches = 0;
  const fetchPage = async () => {
    fetches += 1;
    return { items: [], nextCursor: null, error: null };
  };
  try {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision("admin");
    const staffRead = await loadDeliveryFailuresRequiringAction({
      fetchPage,
      configured: () => true,
      now: () => new Date("2026-11-12T22:58:00.000Z"),
    });
    assert.equal(staffRead.state, "ready");
    assert.equal(fetches, 1);

    fetches = 0;
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult({
      access: "workspace",
      permissions: ["team_workspace", "team_manager"],
      staffPrincipalId: "c123456789012345678901234",
    });
    const managerRead = await loadDeliveryFailuresRequiringAction({
      fetchPage,
      configured: () => true,
    });
    assert.equal(managerRead.state, "unavailable");
    assert.equal(fetches, 0);

    staff.useStaffCapabilitiesTestResult(undefined);
    const observerCookie = session.createAdminCocSessionToken(undefined, SESSION_SECRET, "SA360_OBSERVER");
    guard.useAdminCocTestSessionCookie(observerCookie ?? undefined);
    const observerRead = await loadDeliveryFailuresRequiringAction({
      fetchPage,
      configured: () => true,
      now: () => new Date("2026-11-12T22:58:00.000Z"),
    });
    assert.equal(observerRead.state, "ready");
    assert.equal(fetches, 1);
  } finally {
    guard.useAdminCocTestSessionCookie(undefined);
    guard.useStaffAdminCocTestDecision(undefined);
    staff.useStaffCapabilitiesTestResult(undefined);
    restoreEnv(previous);
  }
});
