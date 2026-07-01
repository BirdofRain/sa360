import "server-only";

import type {
  CreateLeadOrderInput,
  FrontOfficeRole,
  LeadOrder,
  LeadOrdersResponse,
} from "../types";
import { addMockOrder, getMockOrders } from "../mock/orders";

export async function getOrders(role: FrontOfficeRole): Promise<LeadOrdersResponse> {
  return getMockOrders(role);
}

export async function createOrder(
  input: CreateLeadOrderInput,
  role: FrontOfficeRole
): Promise<LeadOrder | null> {
  if (role !== "admin") return null;
  return addMockOrder(input);
}
