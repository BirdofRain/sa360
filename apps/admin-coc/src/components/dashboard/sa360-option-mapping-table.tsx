"use client";

import { useMemo, useState } from "react";
import {
  SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
  SA360_OPTION_MAPPED_FIELD_KEYS,
  type Sa360CustomFieldOptionMap,
} from "@sa360/shared";
import { DIRECT_DEMO_LOCATION_ID } from "@/lib/direct-delivery-demo/types";
import { Button } from "@/components/ui/button";
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

/**
 * Add (or overwrite) a source/canonical → GHL option alias for a dropdown field.
 * Multiple SA360 values may map to the same GHL option (e.g. VET and N_VET → N_VET).
 * Existing mappings for the field are preserved.
 */
export function addOptionAlias(
  optionMap: Sa360CustomFieldOptionMap,
  logicalKey: string,
  sa360Value: string,
  ghlValue: string
): Sa360CustomFieldOptionMap {
  const key = logicalKey.trim();
  const alias = sa360Value.trim();
  const value = ghlValue.trim();
  if (!key || !alias || !value) return optionMap;
  return {
    ...optionMap,
    [key]: { ...(optionMap[key] ?? {}), [alias]: value },
  };
}

/** Remove a single source/canonical alias from a dropdown field mapping. */
export function removeOptionAlias(
  optionMap: Sa360CustomFieldOptionMap,
  logicalKey: string,
  sa360Value: string
): Sa360CustomFieldOptionMap {
  const next: Sa360CustomFieldOptionMap = { ...optionMap };
  const fieldMap = { ...(next[logicalKey] ?? {}) };
  delete fieldMap[sa360Value];
  if (Object.keys(fieldMap).length > 0) next[logicalKey] = fieldMap;
  else delete next[logicalKey];
  return next;
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

  const [aliasField, setAliasField] = useState<string>(SA360_OPTION_MAPPED_FIELD_KEYS[0]);
  const [aliasSource, setAliasSource] = useState("");
  const [aliasGhlValue, setAliasGhlValue] = useState("");

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

  function addAlias() {
    if (!aliasSource.trim() || !aliasGhlValue.trim()) return;
    onChange(addOptionAlias(optionMap, aliasField, aliasSource, aliasGhlValue));
    setAliasSource("");
    setAliasGhlValue("");
  }

  const addAliasForm = (
    <div className="space-y-1 rounded-md border border-dashed border-border p-2">
      <Label className="text-xs">Add source/canonical alias</Label>
      <p className="text-[11px] text-muted-foreground">
        Map a source payload value (e.g. <span className="font-mono">VET</span>) to an existing GHL
        option (e.g. <span className="font-mono">N_VET</span>). Multiple values can target the same
        GHL option.
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <select
          aria-label="Alias field"
          className="rounded border border-input bg-background px-1 py-0.5 font-mono text-xs"
          value={aliasField}
          onChange={(e) => setAliasField(e.target.value)}
        >
          {SA360_OPTION_MAPPED_FIELD_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <input
          aria-label="Alias SA360 value"
          className="w-28 rounded border border-input bg-background px-1 py-0.5 font-mono text-xs"
          value={aliasSource}
          onChange={(e) => setAliasSource(e.target.value)}
          placeholder="SA360 value"
        />
        <span className="text-muted-foreground">→</span>
        <input
          aria-label="Alias GHL option"
          className="w-28 rounded border border-input bg-background px-1 py-0.5 font-mono text-xs"
          value={aliasGhlValue}
          onChange={(e) => setAliasGhlValue(e.target.value)}
          placeholder="GHL option"
          list={`ghl-options-${aliasField}`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!aliasSource.trim() || !aliasGhlValue.trim()}
          onClick={addAlias}
        >
          Add alias
        </Button>
      </div>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <Label>SA360 dropdown option mapping (canonical → GHL value)</Label>
        <p className="text-xs text-muted-foreground">
          No option mappings configured. Discover GHL config or use demo defaults for Smart Agent 360
          Demo, or add a source alias below.
        </p>
        {addAliasForm}
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
      </div>
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
              <th className="px-2 py-1" aria-label="Remove" />
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
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${row.logicalKey} ${row.canonicalValue}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        onChange(removeOptionAlias(optionMap, row.logicalKey, row.canonicalValue))
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {addAliasForm}
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
        option — SA360 will not guess. Add a source alias (e.g. VET → N_VET) to map source payload
        values onto existing GHL options.
      </p>
    </div>
  );
}
