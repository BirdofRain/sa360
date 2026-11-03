"use client";

import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";

import type { GhlDiscoveredCustomField } from "@/lib/ghl-config/types";

type FieldOption = {
  id: string;
  name: string;
};

const UNMAPPED: FieldOption = { id: "", name: "Unmapped" };

function optionLabel(option: FieldOption): string {
  if (!option.id) return "Unmapped";
  return `${option.name} · ${option.id}`;
}

function isFieldOption(value: unknown): value is FieldOption {
  if (!value || typeof value !== "object") return false;
  const option = value as FieldOption;
  return typeof option.id === "string" && typeof option.name === "string";
}

/** Case-insensitive match on the discovered field name or field id. */
function ghlFieldOptionMatches(option: FieldOption, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  if (!option.id) return option.name.toLocaleLowerCase().includes(needle);
  return (
    option.name.toLocaleLowerCase().includes(needle) ||
    option.id.toLocaleLowerCase().includes(needle)
  );
}

export function GhlFieldMappingSelect({
  canonical,
  fields,
  value,
  onChange,
}: {
  canonical: string;
  fields: readonly GhlDiscoveredCustomField[];
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const options = useMemo(() => {
    const discovered: FieldOption[] = [];
    for (const field of fields) {
      if (!field.id) continue;
      discovered.push({ id: field.id, name: field.name });
    }
    return [UNMAPPED, ...discovered];
  }, [fields]);

  const displayedId = options.some((option) => option.id !== "" && option.id === value) ? value : "";
  const selected = options.find((option) => option.id === displayedId) ?? UNMAPPED;

  return (
    <div className="min-w-0">
      <Combobox.Root
        items={options}
        value={selected}
        onValueChange={(next, details) => {
          // Typed search and input clears must not become the stored field id.
          if (!isFieldOption(next)) {
            details.cancel();
            return;
          }
          if (next.id === displayedId) return;
          onChange(next.id);
        }}
        isItemEqualToValue={(item, current) => item.id === current.id}
        itemToStringLabel={optionLabel}
        itemToStringValue={(option) => option.id}
        filter={ghlFieldOptionMatches}
        autoHighlight
      >
        <Combobox.Trigger
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 text-left text-sm text-slate-900"
          aria-label={`GHL field for ${canonical}`}
        >
          <span className="min-w-0 truncate">
            <Combobox.Value />
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-500" aria-hidden />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner className="z-50 outline-none" sideOffset={4} align="start">
            <Combobox.Popup className="w-max min-w-[var(--anchor-width)] max-w-[24rem] rounded-lg border border-slate-200 bg-white p-1 shadow-md outline-none">
              <Combobox.Input
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                placeholder="Search field name or id"
                aria-label={`Search GHL fields for ${canonical}`}
                autoComplete="off"
              />
              <Combobox.Empty className="px-2 py-1.5 text-sm text-slate-500">
                No matching GHL fields.
              </Combobox.Empty>
              <Combobox.List
                className="max-h-60 overflow-y-auto"
                data-testid={`ghl-field-options-${canonical}`}
              >
                {(option: FieldOption) => (
                  <Combobox.Item
                    key={option.id || "unmapped"}
                    value={option}
                    className="flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm text-slate-900 data-[highlighted]:bg-slate-100"
                  >
                    <span>{option.id ? option.name : "Unmapped"}</span>
                    {option.id ? (
                      <span className="font-mono text-xs break-all text-slate-500">{option.id}</span>
                    ) : null}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
