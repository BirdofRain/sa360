import {
  ORDER_STATUS_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
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
          Submit a new order to start fulfillment tracking.
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
            <TableHead>Campaign</TableHead>
            <TableHead>CRM</TableHead>
            <TableHead>AI/Voice</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const statusKey = order.status ?? order.adminStatus;
            const status =
              ORDER_STATUS_DISPLAY[statusKey] ?? ORDER_STATUS_DISPLAY.submitted;
            return (
              <TableRow
                key={order.id}
                className={onSelect ? "cursor-pointer hover:bg-slate-50" : undefined}
                onClick={() => onSelect?.(order)}
              >
                <TableCell className="font-medium">{order.orderNumber ?? order.id}</TableCell>
                <TableCell>{order.clientName}</TableCell>
                <TableCell>{order.niche}</TableCell>
                <TableCell>{order.state}</TableCell>
                <TableCell>{order.volume.toLocaleString()}</TableCell>
                <TableCell className="text-xs">{order.campaignType}</TableCell>
                <TableCell className="text-xs">{order.crmPackage}</TableCell>
                <TableCell>{order.aiVoiceAddon ? "Yes" : "No"}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs">
                  {order.deliveryDestination}
                </TableCell>
                <TableCell>
                  <FoStatusPill label={status.label} className={status.className} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {formatDateTime(order.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
