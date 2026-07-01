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

export function FoOrderList({ orders }: { orders: LeadOrder[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Niche</TableHead>
            <TableHead>State</TableHead>
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
            const status = ORDER_STATUS_DISPLAY[order.adminStatus];
            return (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.id}</TableCell>
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
