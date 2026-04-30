import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FLAGS = [
  { key: "VOICE_ENABLED", scope: "global", value: "env" },
  { key: "META_SYNC_ENABLED", scope: "global", value: "env" },
  { key: "SYNTHFLOW_INBOUND_ENABLED", scope: "global", value: "env" },
  { key: "REPLAY_ENABLED", scope: "global", value: "off" },
] as const;

export default function FlagsPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Production toggles may remain env-backed; DB-backed flags can override per client when the
        admin API exists.
      </p>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Key</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FLAGS.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="font-mono text-xs">{f.key}</TableCell>
                <TableCell>{f.scope}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {f.value}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
