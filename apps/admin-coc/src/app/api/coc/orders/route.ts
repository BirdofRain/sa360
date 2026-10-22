import { NextResponse } from "next/server";

import { loadCocLeadOrders } from "@/lib/coc-orders/load-coc-lead-orders";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET() {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;

  const loaded = await loadCocLeadOrders();
  if (loaded.error) {
    return NextResponse.json(
      { ok: false, error: loaded.error, orders: [] },
      { status: loaded.configured ? 502 : 503 }
    );
  }
  return NextResponse.json({
    ok: true,
    orders: loaded.orders,
    truncated: loaded.truncated,
  });
}
