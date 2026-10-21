"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FoNewOrderForm } from "@/components/front-office/orders/fo-new-order-form";
import { FoOrderDetailDrawer } from "@/components/front-office/orders/fo-order-detail-drawer";
import { FoOrderList } from "@/components/front-office/orders/fo-order-list";
import { FRONT_OFFICE_ORDERS_API } from "@/lib/front-office/api/lead-order-review-client";
import { matchesReviewQueueFilter, type ReviewQueueFilter } from "@/lib/front-office/order-review";
import type { FrontOfficeRole, LeadOrder, LeadOrdersResponse } from "@/lib/front-office/types";

export function FoOrdersContent({
  initial,
  role,
  showCreateForm = false,
  ordersApiBase = FRONT_OFFICE_ORDERS_API,
  initialError = null,
}: {
  initial: LeadOrdersResponse;
  role: FrontOfficeRole;
  showCreateForm?: boolean;
  /** Live list and review routes. COC passes the admin-only orders API. */
  ordersApiBase?: string;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initial.orders);
  const [statusFilter, setStatusFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("review");
  const [clientFilter, setClientFilter] = useState("");
  const [nicheFilter, setNicheFilter] = useState("");
  const [selected, setSelected] = useState<LeadOrder | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissedInitialError, setDismissedInitialError] = useState(false);
  const visibleError = listError ?? (dismissedInitialError ? null : initialError);
  const blockEmpty = orders.length === 0 && Boolean(visibleError);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && (o.status ?? o.adminStatus) !== statusFilter) return false;
      if (role === "admin" && !matchesReviewQueueFilter(o, reviewFilter)) return false;
      if (clientFilter && !o.clientName.toLowerCase().includes(clientFilter.toLowerCase())) {
        return false;
      }
      if (nicheFilter && !o.niche.toLowerCase().includes(nicheFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [orders, statusFilter, reviewFilter, clientFilter, nicheFilter, role]);

  function refreshOrders() {
    setLoading(true);
    router.refresh();
    fetch(ordersApiBase)
      .then(async (r) => {
        const data = (await r.json()) as {
          ok: boolean;
          orders?: LeadOrdersResponse["orders"];
          error?: string;
        };
        if (data.ok && data.orders) {
          setOrders(data.orders);
          setListError(null);
          setDismissedInitialError(true);
          return;
        }
        setListError(data.error || "Could not refresh orders.");
      })
      .catch(() => {
        setListError("Could not refresh orders.");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <div className="space-y-6">
      {showCreateForm ? <FoNewOrderForm role={role} onCreated={refreshOrders} /> : null}

      {role === "admin" ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={refreshOrders}
            disabled={loading}
            data-testid="orders-refresh"
          >
            Refresh
          </Button>
        </div>
      ) : null}

      {role === "admin" ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-review">Review queue</Label>
            <Select
              id="filter-review"
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value as ReviewQueueFilter)}
            >
              <option value="review">Needs review or approved</option>
              <option value="submitted_payment_pending">Submitted / Payment pending</option>
              <option value="submitted_payment_confirmed">Submitted / Payment confirmed</option>
              <option value="submitted_payment_not_required">
                Submitted / Payment not required
              </option>
              <option value="approved_ready">Approved / Ready</option>
              <option value="all">All orders</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="needs_setup">Needs setup</option>
              <option value="needs_compliance">Needs compliance</option>
              <option value="ready">Ready</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-client">Client</Label>
            <Input
              id="filter-client"
              placeholder="Filter by client"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-niche">Niche</Label>
            <Input
              id="filter-niche"
              placeholder="Filter by niche"
              value={nicheFilter}
              onChange={(e) => setNicheFilter(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {visibleError ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
          data-testid="orders-list-error"
        >
          {visibleError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-600" data-testid="orders-list-loading" role="status">
          Loading orders…
        </p>
      ) : null}

      {!loading && filtered.length === 0 && orders.length > 0 ? (
        <div
          className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"
          data-testid="orders-filter-empty"
        >
          <p className="text-sm font-medium text-slate-900">No orders match these filters</p>
          <p className="mt-1 text-xs text-slate-500">
            Clear a filter or choose All orders to see the rest of the list.
          </p>
        </div>
      ) : orders.length > 0 || (!loading && !blockEmpty) ? (
        <FoOrderList
          orders={filtered}
          onSelect={(order) => {
            setSelected(order);
            setDrawerOpen(true);
          }}
        />
      ) : null}

      <FoOrderDetailDrawer
        order={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        isAdmin={role === "admin"}
        apiBase={ordersApiBase}
        onUpdated={(order) => {
          setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
          setSelected(order);
        }}
      />
    </div>
  );
}
