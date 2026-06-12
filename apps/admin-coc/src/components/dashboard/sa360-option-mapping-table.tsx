"use client";

import { useMemo } from "react";
import {
  SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
  SA360_OPTION_MAPPED_FIELD_KEYS,
  type Sa360CustomFieldOptionMap,
} from "@sa360/shared";
import { DIRECT_DEMO_LOCATION_ID } from "@/lib/direct-delivery-demo/types";
import { Label } from "@/components/ui/label";

export type Sa360OptionMappingRowView = {
  logicalKey: string;
  canonicalValue: string;
  mappedGhlValue: string;
  discoveredGhlOptions: string[];
};

function statusForRow(
  mappedGhlValue: string,
  discoveredGhlOptions: string[]
): "mapped" | "missing" | "invalid" {
  if (!mappedGhlValue.trim()) return "missing";
  if (discoveredGhlOptions.length === 0) return "mapped";
  const normalized = mappedGhlValue.trim().toLowerCase();
  const ok = discoveredGhlOptions.some((o) => o.trim().toLowerCase() === normalized);
  return ok ? "mapped" : "invalid";
}

function discoveredOptionsForField(
  customFields: Array<{ fieldKey?: string | null; picklistOptions?: string[] | null; dataType?: string | null }>,
  logicalKey: string
): string[] {
  const suffix = logicalKey.replace(/^sa360_/, "");
  for (const field of customFields) {
    const key = (field.fieldKey ?? "").toLowerCase();
    if (!key.includes(suffix)) continue;
    if (Array.isArray(field.picklistOptions) && field.picklistOptions.length > 0) {
      return field.picklistOptions;
    }
  }
  return [];
}

export function buildInitialOptionMap(input: {
  locationId: string;
  savedOptionMap?: Sa360CustomFieldOptionMap | null;
}): Sa360CustomFieldOptionMap {
  const saved = input.savedOptionMap ?? {};
  if (Object.keys(saved).length > 0) return { ...saved };
  if (input.locationId === DIRECT_DEMO_LOCATION_ID) {
    return { ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP };
  }
  return {};
}

export function Sa360OptionMappingTable({
  optionMap,
  onChange,
  customFields,
}: {
  optionMap: Sa360CustomFieldOptionMap;
  onChange: (next: Sa360CustomFieldOptionMap) => void;
  customFields: Array<{
    fieldKey?: string | null;
    picklistOptions?: string[] | null;
    dataType?: string | null;
  }>;
}) {
  const rows = useMemo(() => {
    const out: Sa360OptionMappingRowView[] = [];
    for (const logicalKey of SA360_OPTION_MAPPED_FIELD_KEYS) {
      const fieldMap = optionMap[logicalKey] ?? {};
      const discoveredGhlOptions = discoveredOptionsForField(customFields, logicalKey);
      const canonicalValues = Object.keys(fieldMap).sort();
      if (canonicalValues.length === 0 && discoveredGhlOptions.length > 0) {
        for (const opt of discoveredGhlOptions) {
          out.push({
            logicalKey,
            canonicalValue: opt.toUpperCase(),
            mappedGhlValue: fieldMap[opt.toUpperCase()] ?? "",
            discoveredGhlOptions,
          });
        }
        continue;
      }
      for (const canonicalValue of canonicalValues) {
        out.push({
          logicalKey,
          canonicalValue,
          mappedGhlValue: fieldMap[canonicalValue] ?? "",
          discoveredGhlOptions,
        });
      }
    }
    return out;
  }, [optionMap, customFields]);

  function updateRow(logicalKey: string, canonicalValue: string, mappedGhlValue: string) {
    const next: Sa360CustomFieldOptionMap = { ...optionMap };
    const fieldMap = { ...(next[logicalKey] ?? {}) };
    if (mappedGhlValue.trim()) {
      fieldMap[canonicalValue] = mappedGhlValue.trim();
    } else {
      delete fieldMap[canonicalValue];
    }
    if (Object.keys(fieldMap).length > 0) next[logicalKey] = fieldMap;
    else delete next[logicalKey];
    onChange(next);
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No option mappings configured. Discover GHL config or use demo defaults for Smart Agent 360
        Demo.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label>SA360 dropdown option mapping (canonical → GHL value)</Label>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border text-xs">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="px-2 py-1">Field</th>
              <th className="px-2 py-1">SA360 value</th>
              <th className="px-2 py-1">GHL option</th>
              <th className="px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = statusForRow(row.mappedGhlValue, row.discoveredGhlOptions);
              return (
                <tr
                  key={`${row.logicalKey}:${row.canonicalValue}`}
                  className="border-b border-border/60"
                >
                  <td className="px-2 py-1 font-mono">{row.logicalKey}</td>
                  <td className="px-2 py-1 font-mono">{row.canonicalValue}</td>
                  <td className="px-2 py-1">
                    <input
                      className="w-full rounded border border-input bg-background px-1 py-0.5 font-mono text-xs"
                      value={row.mappedGhlValue}
                      onChange={(e) =>
                        updateRow(row.logicalKey, row.canonicalValue, e.target.value)
                      }
                      placeholder="GHL option value"
                      list={
                        row.discoveredGhlOptions.length > 0
                          ? `ghl-options-${row.logicalKey}`
                          : undefined
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    {status === "mapped" ? (
                      <span className="text-emerald-700 dark:text-emerald-300">mapped</span>
                    ) : status === "invalid" ? (
                      <span className="text-red-700 dark:text-red-300">invalid</span>
                    ) : (
                      <span className="text-amber-800 dark:text-amber-200">missing</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {SA360_OPTION_MAPPED_FIELD_KEYS.map((logicalKey) => {
        const opts = discoveredOptionsForField(customFields, logicalKey);
        if (opts.length === 0) return null;
        return (
          <datalist key={logicalKey} id={`ghl-options-${logicalKey}`}>
            {opts.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Unmapped values like routing_status CREATED require an explicit mapping or a new GHL dropdown
        option — SA360 will not guess.
      </p>
    </div>
  );
}
