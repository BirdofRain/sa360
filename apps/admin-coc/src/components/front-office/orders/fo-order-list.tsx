import {
  ORDER_STATUS_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
import {
  reviewQueueClassName,
  reviewQueueLabel,
} from "@/lib/front-office/order-review";
import type { LeadOrder } from "@/lib/front-office/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FoStatusPill } from "../shared/fo-status-pill";

export function FoOrderList({
  orders,
  onSelect,
}: {
  orders: LeadOrder[];
  onSelect?: (order: LeadOrder) => void;
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-900">No orders yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Submitted orders appear here for payment confirmation and approval.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Niche</TableHead>
            <TableHead>States</TableHead>
            <TableHead>Volume</TableHead>
            <TableHead>Review</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const statusKey = order.status ?? order.adminStatus;
            const status =
              ORDER_STATUS_DISPLAY[statusKey] ?? ORDER_STATUS_DISPLAY.submitted;
            const queueLabel = reviewQueueLabel(order);
            const queueClass = reviewQueueClassName(order);
            return (
              <TableRow
                key={order.id}
                className={onSelect ? "cursor-pointer hover:bg-slate-50" : undefined}
                onClick={() => onSelect?.(order)}
                data-testid={`fo-order-row-${order.id}`}
              >
                <TableCell className="font-medium">{order.orderNumber ?? order.id}</TableCell>
                <TableCell>{order.clientName}</TableCell>
                <TableCell>{order.niche}</TableCell>
                <TableCell>{order.state}</TableCell>
                <TableCell>{order.volume.toLocaleString()}</TableCell>
                <TableCell>
                  {queueLabel && queueClass ? (
                    <FoStatusPill label={queueLabel} className={queueClass} />
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <FoStatusPill label={status.label} className={status.className} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {formatDateTime(order.submittedAt ?? order.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
