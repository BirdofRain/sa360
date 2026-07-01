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
  getLeadOrdersWithFallback,
  updateLeadOrderLive,
} from "../live/orders-adapter";

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
  clientAccountId?: string
): Promise<LeadOrder | null> {
  const live = await createLeadOrderLive(input, { role, clientAccountId });
  if (live) return live;

  if (role === "client" || role === "admin") {
    return addMockOrder(input, role);
  }
  return null;
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
