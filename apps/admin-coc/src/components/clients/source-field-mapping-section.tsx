"use client";

import { useState, useTransition } from "react";
import { saveClientGhlConfigAction } from "@/app/actions/ghl-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClientGhlDestination } from "@/lib/clients/types";
import type { GhlDiscoveredCustomField } from "@/lib/ghl-config/types";

const CANONICAL_ATTRIBUTES = [
  "best_time_to_call",
  "age",
  "marital_status",
  "desired_coverage",
  "branch_of_service",
  "primary_reason",
  "beneficiary",
  "military_status",
  "sex",
] as const;

type FieldRequirement = "optional" | "automation_required" | "ignored";

type MappingEntry = {
  ghlFieldKey: string;
  requirement: FieldRequirement;
};

function parseMap(raw: unknown): Record<string, MappingEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, MappingEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = { ghlFieldKey: value.trim(), requirement: "optional" };
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      const ghlFieldKey = typeof v.ghlFieldKey === "string" ? v.ghlFieldKey.trim() : "";
      if (!ghlFieldKey) continue;
      const req = v.requirement;
      out[key] = {
        ghlFieldKey,
        requirement:
          req === "automation_required" || req === "ignored" ? req : "optional",
      };
    }
  }
  return out;
}

export function SourceFieldMappingSection({
  clientAccountId,
  locationId,
  ghlDestination,
  discoveredCustomFields,
  onSaved,
}: {
  clientAccountId: string;
  locationId: string;
  ghlDestination: ClientGhlDestination | null;
  discoveredCustomFields: GhlDiscoveredCustomField[];
  onSaved?: (dest: ClientGhlDestination) => void;
}) {
  const [map, setMap] = useState<Record<string, MappingEntry>>(() =>
    parseMap(ghlDestination?.sourceAttributeFieldMapJson)
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fieldOptions = discoveredCustomFields
    .map((f) => ({
      key: f.fieldKey ?? f.key ?? f.id,
      label: f.name,
    }))
    .filter((f) => f.key);

  function updateRow(canonical: string, patch: Partial<MappingEntry>) {
    setMap((prev) => ({
      ...prev,
      [canonical]: {
        ghlFieldKey: prev[canonical]?.ghlFieldKey ?? "",
        requirement: prev[canonical]?.requirement ?? "optional",
        ...patch,
      },
    }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const sourceAttributeFieldMapJson: Record<string, MappingEntry> = {};
      for (const [k, v] of Object.entries(map)) {
        if (v.ghlFieldKey.trim()) sourceAttributeFieldMapJson[k] = v;
      }
      const res = await saveClientGhlConfigAction(clientAccountId, {
        locationId,
        sourceAttributeFieldMapJson,
      });
      if (!res.ok) {
        setMessage("error" in res ? (res.error ?? "Save failed.") : "Save failed.");
        return;
      }
      if (!res.ghlDestination) {
        setMessage("Save failed — no destination returned.");
        return;
      }
      setMessage("Source field mappings saved.");
      onSaved?.(res.ghlDestination);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">Source survey field mapping</h3>
        <p className="text-xs text-muted-foreground">
          Map canonical intake attributes to discovered GHL contact fields. No redeploy required.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Canonical attribute</TableHead>
            <TableHead>Destination GHL field</TableHead>
            <TableHead>Requirement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CANONICAL_ATTRIBUTES.map((canonical) => {
            const row = map[canonical] ?? { ghlFieldKey: "", requirement: "optional" as const };
            return (
              <TableRow key={canonical}>
                <TableCell className="font-mono text-xs">{canonical}</TableCell>
                <TableCell>
                  {fieldOptions.length > 0 ? (
                    <select
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                      value={row.ghlFieldKey}
                      onChange={(e) => updateRow(canonical, { ghlFieldKey: e.target.value })}
                    >
                      <option value="">— unmapped —</option>
                      {fieldOptions.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label} ({f.key})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="h-8 text-xs"
                      value={row.ghlFieldKey}
                      onChange={(e) => updateRow(canonical, { ghlFieldKey: e.target.value })}
                      placeholder="contact.field_key"
                    />
                  )}
                </TableCell>
                <TableCell>
                  <select
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                    value={row.requirement}
                    onChange={(e) =>
                      updateRow(canonical, { requirement: e.target.value as FieldRequirement })
                    }
                  >
                    <option value="optional">Optional</option>
                    <option value="automation_required">Require for AI</option>
                    <option value="ignored">Ignore</option>
                  </select>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          Save source mappings
        </Button>
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      </div>
    </div>
  );
}
