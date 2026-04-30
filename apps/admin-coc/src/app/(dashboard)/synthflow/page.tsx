import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function SynthflowPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tracks from/to numbers, model, known_caller, matched_by, lookup_status, GHL ids, and errors
        once `SynthflowRequestLog` (or unified ingest log) is wired.
      </p>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>lookup_status</TableHead>
              <TableHead>known_caller</TableHead>
              <TableHead>matched_by</TableHead>
              <TableHead>contact_id_ghl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                No data — awaiting admin API
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
