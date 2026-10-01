"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientProfileOption } from "@/lib/clients/client-profile-options";

function keyOf(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function normalizeProfileValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((raw) => {
    const value = raw.trim();
    const key = keyOf(value);
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

export function ClientProfileMultiSelect({
  label,
  options,
  value,
  onChange,
  allowCustom = true,
  disabled,
}: {
  label: string;
  options: readonly ClientProfileOption[];
  value: string[];
  onChange: (value: string[]) => void;
  allowCustom?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = normalizeProfileValues(value);
  const selectedKeys = new Set(selected.map(keyOf));
  const q = keyOf(query);
  const matches = options.filter(
    (option) =>
      !selectedKeys.has(keyOf(option.value)) &&
      (!q || keyOf(option.label).includes(q) || keyOf(option.value).includes(q))
  );

  function add(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const known = options.find(
      (option) => keyOf(option.value) === keyOf(trimmed) || keyOf(option.label) === keyOf(trimmed)
    );
    const next = known?.value ?? trimmed;
    if (!known && !allowCustom) {
      setError("Choose a value from the catalog.");
      return;
    }
    if (!known && !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/.test(next)) {
      setError("Use 1–80 letters, numbers, spaces, hyphens, or underscores.");
      return;
    }
    if (selectedKeys.has(keyOf(next))) {
      setError("That value is already selected.");
      return;
    }
    onChange([...selected, next]);
    setQuery("");
    setError(null);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${label.toLowerCase()}`}>
          {selected.map((item) => {
            const option = options.find((candidate) => keyOf(candidate.value) === keyOf(item));
            return (
              <li key={keyOf(item)}>
                <button
                  type="button"
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-900"
                  onClick={() => onChange(selected.filter((candidate) => keyOf(candidate) !== keyOf(item)))}
                  disabled={disabled}
                  aria-label={`Remove ${option?.label ?? item}`}
                >
                  {option?.label ?? item} <span aria-hidden>×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No values selected.</p>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(matches[0]?.value ?? query);
            }
          }}
          placeholder="Search or add…"
          disabled={disabled}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          aria-invalid={Boolean(error)}
        />
        <Button type="button" variant="outline" onClick={() => add(matches[0]?.value ?? query)} disabled={disabled || !query.trim()}>
          Add
        </Button>
      </div>
      {query.trim() ? (
        <div className="flex flex-wrap gap-1" role="listbox" aria-label={`${label} suggestions`}>
          {matches.slice(0, 6).map((option) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={option.value}
              onClick={() => add(option.value)}
              className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
            >
              {option.label}
            </button>
          ))}
          {!matches.length && !allowCustom ? (
            <span className="text-xs text-muted-foreground">No matching catalog values.</span>
          ) : null}
        </div>
      ) : null}
      <p id={`${id}-help`} className="text-[11px] text-muted-foreground">
        {allowCustom
          ? "Catalog labels preserve canonical stored values. Admin-added values do not enable intake or fulfillment."
          : "Choose one or more catalog values."}
      </p>
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
