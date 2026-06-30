import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import {
  InventoryStatusBadge,
  ProofStatusBadge,
  VerificationStatusBadge,
} from "@/components/lead-fulfillment/status-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecentLeadIntakeRow } from "@/lib/lead-fulfillment/types";

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function RecentLeadIntakeTable({ rows }: { rows: RecentLeadIntakeRow[] }) {
  return (
    <SectionPanel
      title="Recent lead intake"
      action={
        <Link href="/source-intake" className="text-xs font-medium text-blue-600 hover:underline">
          Full queue →
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No recent intake" hint="New leads will appear here once LF1 intake is wired." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="px-4">Lead UID</TableHead>
              <TableHead className="px-4">Source lane</TableHead>
              <TableHead className="px-4">State</TableHead>
              <TableHead className="px-4">Niche</TableHead>
              <TableHead className="px-4">Proof status</TableHead>
              <TableHead className="px-4">Verification status</TableHead>
              <TableHead className="px-4">Inventory status</TableHead>
              <TableHead className="px-4">Created at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.leadUid}>
                <TableCell className="px-4 font-mono text-xs text-slate-800">{row.leadUid}</TableCell>
                <TableCell className="max-w-[180px] px-4 text-slate-600">{row.sourceLane}</TableCell>
                <TableCell className="px-4 text-slate-600">{row.state}</TableCell>
                <TableCell className="px-4 text-slate-600">{row.niche}</TableCell>
                <TableCell className="px-4">
                  <ProofStatusBadge status={row.proofStatus} />
                </TableCell>
                <TableCell className="px-4">
                  <VerificationStatusBadge status={row.verificationStatus} />
                </TableCell>
                <TableCell className="px-4">
                  <InventoryStatusBadge status={row.inventoryStatus} />
                </TableCell>
                <TableCell className="px-4 text-xs text-slate-500">{formatCreatedAt(row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionPanel>
  );
}
