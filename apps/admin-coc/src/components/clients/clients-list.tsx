"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteClientAction } from "@/app/actions/clients";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClientAccountListItem } from "@/lib/clients/types";

export function ClientsList({ items: initialItems }: { items: ClientAccountListItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function removeClient(row: ClientAccountListItem) {
    if (
      !window.confirm(
        `Delete client "${row.clientDisplayName}" (${row.clientAccountId}) and all its routing rules?`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteClientAction(row.clientAccountId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((c) => c.clientAccountId !== row.clientAccountId));
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-muted-foreground">
        No client accounts yet. Create one to start onboarding.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
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
              <TableHead className="text-right">Actions</TableHead>
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
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/clients/${encodeURIComponent(row.clientAccountId)}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      View
                    </Link>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => removeClient(row)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
