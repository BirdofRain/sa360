"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FoNewOrderForm } from "@/components/front-office/orders/fo-new-order-form";
import { FoOrderDetailDrawer } from "@/components/front-office/orders/fo-order-detail-drawer";
import { FoOrderList } from "@/components/front-office/orders/fo-order-list";
import type { FrontOfficeRole, LeadOrder, LeadOrdersResponse } from "@/lib/front-office/types";

export function FoOrdersContent({
  initial,
  role,
  showCreateForm = false,
}: {
  initial: LeadOrdersResponse;
  role: FrontOfficeRole;
  showCreateForm?: boolean;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initial.orders);
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [nicheFilter, setNicheFilter] = useState("");
  const [selected, setSelected] = useState<LeadOrder | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && (o.status ?? o.adminStatus) !== statusFilter) return false;
      if (clientFilter && !o.clientName.toLowerCase().includes(clientFilter.toLowerCase())) {
        return false;
      }
      if (nicheFilter && !o.niche.toLowerCase().includes(nicheFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [orders, statusFilter, clientFilter, nicheFilter]);

  function refreshOrders() {
    router.refresh();
    fetch("/api/front-office/orders")
      .then((r) => r.json())
      .then((data: { ok: boolean; orders?: LeadOrdersResponse["orders"] }) => {
        if (data.ok && data.orders) setOrders(data.orders);
      });
  }

  return (
    <div className="space-y-6">
      {showCreateForm ? <FoNewOrderForm role={role} onCreated={refreshOrders} /> : null}

      {role === "admin" ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
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

      <FoOrderList
        orders={filtered}
        onSelect={(order) => {
          setSelected(order);
          setDrawerOpen(true);
        }}
      />

      <FoOrderDetailDrawer
        order={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        isAdmin={role === "admin"}
        onUpdated={(order) => {
          setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
          setSelected(order);
        }}
      />
    </div>
  );
}
