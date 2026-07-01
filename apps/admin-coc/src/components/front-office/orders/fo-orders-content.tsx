"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FoNewOrderForm } from "@/components/front-office/orders/fo-new-order-form";
import { FoOrderList } from "@/components/front-office/orders/fo-order-list";
import type { LeadOrdersResponse } from "@/lib/front-office/types";

export function FoOrdersContent({
  initial,
  showCreateForm = false,
}: {
  initial: LeadOrdersResponse;
  showCreateForm?: boolean;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initial.orders);

  return (
    <div className="space-y-6">
      {showCreateForm ? (
        <FoNewOrderForm
          onCreated={() => {
            router.refresh();
            fetch("/api/front-office/orders")
              .then((r) => r.json())
              .then((data: { ok: boolean; orders?: LeadOrdersResponse["orders"] }) => {
                if (data.ok && data.orders) setOrders(data.orders);
              });
          }}
        />
      ) : null}
      <FoOrderList orders={orders} />
    </div>
  );
}
