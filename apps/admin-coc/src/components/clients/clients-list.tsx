"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClientAccountListItem } from "@/lib/clients/types";

export function ClientsList({ items }: { items: ClientAccountListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-muted-foreground">
        No client accounts yet. Create one to start onboarding.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Portal</TableHead>
            <TableHead>GHL subaccount</TableHead>
            <TableHead>Niches</TableHead>
            <TableHead className="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.clientAccountId}>
              <TableCell>
                <Link
                  href={`/clients/${encodeURIComponent(row.clientAccountId)}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {row.clientDisplayName}
                </Link>
                <div className="font-mono text-[11px] text-slate-500">{row.clientAccountId}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{row.status}</Badge>
              </TableCell>
              <TableCell>{row.portalEnabled ? "Enabled" : "Off"}</TableCell>
              <TableCell className="font-mono text-xs">
                {row.destinationSubaccountIdGhl ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-slate-600">
                {row.primaryNicheKeys.join(", ") || "—"}
              </TableCell>
              <TableCell className="text-right text-xs text-slate-500">
                {new Date(row.updatedAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
