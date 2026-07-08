import "server-only";

import type {
  CreateLeadOrderInput,
  FrontOfficeRole,
  LeadOrder,
  LeadOrdersResponse,
  UpdateLeadOrderInput,
} from "../types";
import { addMockOrder, getMockOrders } from "../mock/orders";
import {
  createLeadOrderLive,
  type CreateLeadOrderLiveResult,
  getLeadOrdersWithFallback,
  updateLeadOrderLive,
} from "../live/orders-adapter";

const DEMO_MODE_FLAG = "SA360_FRONT_OFFICE_DEMO_MODE";

function isFrontOfficeDemoModeEnabled(): boolean {
  return process.env[DEMO_MODE_FLAG]?.trim() === "true";
}

export type CreateOrderResult =
  | { ok: true; order: LeadOrder; dataSource: "live" | "mock"; demoMode: boolean; warning?: string }
  | { ok: false; error: string; code: string; status: number };

type CreateOrderDeps = {
  createLeadOrderLiveImpl?: (
    input: CreateLeadOrderInput,
    scope: { role: FrontOfficeRole; clientAccountId?: string }
  ) => Promise<CreateLeadOrderLiveResult>;
  addMockOrderImpl?: typeof addMockOrder;
};

export async function getOrders(
  role: FrontOfficeRole,
  opts: {
    clientAccountId?: string;
    status?: string;
    nicheKey?: string;
  } = {}
): Promise<LeadOrdersResponse> {
  return getLeadOrdersWithFallback(
    { role, clientAccountId: opts.clientAccountId },
    {
      status: opts.status,
      nicheKey: opts.nicheKey,
      clientAccountId: opts.clientAccountId,
    }
  );
}

export async function createOrder(
  input: CreateLeadOrderInput,
  role: FrontOfficeRole,
  clientAccountId?: string,
  deps: CreateOrderDeps = {}
): Promise<CreateOrderResult> {
  const createLeadOrderLiveImpl = deps.createLeadOrderLiveImpl ?? createLeadOrderLive;
  const addMockOrderImpl = deps.addMockOrderImpl ?? addMockOrder;

  const live = await createLeadOrderLiveImpl(input, { role, clientAccountId });
  if (live.ok) {
    return { ok: true, order: live.order, dataSource: "live", demoMode: false };
  }

  const demoMode = isFrontOfficeDemoModeEnabled();
  if (demoMode && role === "admin") {
    const mockOrder = addMockOrderImpl(input, role);
    return {
      ok: true,
      order: mockOrder,
      dataSource: "mock",
      demoMode: true,
      warning:
        "Live order creation failed; returning a clearly labeled demo mock order because SA360_FRONT_OFFICE_DEMO_MODE=true.",
    };
  }

  return {
    ok: false,
    error: live.error || "Live lead-order creation failed.",
    code: live.code,
    status: 503,
  };
}

export async function updateOrder(
  id: string,
  input: UpdateLeadOrderInput,
  role: FrontOfficeRole
): Promise<LeadOrder | null> {
  if (role !== "admin") return null;
  const live = await updateLeadOrderLive(id, input);
  if (live) return live;
  return null;
}

export async function getOrdersMockOnly(role: FrontOfficeRole): Promise<LeadOrdersResponse> {
  return getMockOrders(role);
}
