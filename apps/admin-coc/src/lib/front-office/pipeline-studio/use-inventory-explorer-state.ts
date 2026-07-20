"use client";

import { useMemo, useState } from "react";

import {
  clampRequestedQuantity,
  deriveInventoryExplorer,
} from "./inventory-compute";
import type {
  AgeBucketKey,
  InventoryExplorerReadModel,
  InventoryFilters,
  InventoryNicheKey,
  TimezoneKey,
} from "./inventory-types";

export type QuoteDrawerMode = "custom_fulfillment" | "inventory_review" | null;

export function useInventoryExplorerState(model: InventoryExplorerReadModel) {
  const [filters, setFilters] = useState<InventoryFilters>(() => ({
    ...model.defaultFilters,
    selectedAgeBuckets: [...model.defaultFilters.selectedAgeBuckets],
  }));
  const [selectedStateCodes, setSelectedStateCodes] = useState<Set<string>>(
    () => new Set()
  );
  const [focusedStateCode, setFocusedStateCode] = useState<string | null>("NC");
  const [quoteMode, setQuoteMode] = useState<QuoteDrawerMode>(null);
  const [quoteNotes, setQuoteNotes] = useState("");
  const [requestedDate, setRequestedDate] = useState("2026-08-01");
  const [quoteOptions, setQuoteOptions] = useState<string[]>([]);

  const derived = useMemo(
    () => deriveInventoryExplorer(model, filters, selectedStateCodes),
    [model, filters, selectedStateCodes]
  );

  const focusedState =
    derived.states.find((s) => s.stateCode === focusedStateCode) ?? null;

  function resetFilters() {
    setFilters({
      ...model.defaultFilters,
      selectedAgeBuckets: [...model.defaultFilters.selectedAgeBuckets],
    });
    setSelectedStateCodes(new Set());
  }

  function setNiche(nicheKey: InventoryNicheKey) {
    setFilters((f) => ({ ...f, nicheKey }));
  }

  function toggleAgeBucket(key: AgeBucketKey) {
    setFilters((f) => {
      const has = f.selectedAgeBuckets.includes(key);
      const next = has
        ? f.selectedAgeBuckets.filter((k) => k !== key)
        : [...f.selectedAgeBuckets, key];
      return {
        ...f,
        selectedAgeBuckets: next.length > 0 ? next : [key],
      };
    });
  }

  function setTimezone(tz: TimezoneKey | null) {
    setFilters((f) => ({ ...f, selectedTimezone: tz }));
  }

  function setRequestedQuantity(value: number) {
    setFilters((f) => ({
      ...f,
      requestedQuantity: clampRequestedQuantity(value),
    }));
  }

  function focusState(code: string) {
    setFocusedStateCode(code);
  }

  function toggleSelection(code: string) {
    setSelectedStateCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function openQuote(mode: Exclude<QuoteDrawerMode, null>) {
    setQuoteMode(mode);
  }

  function closeQuote() {
    setQuoteMode(null);
  }

  function toggleQuoteOption(option: string) {
    setQuoteOptions((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

  return {
    model,
    filters,
    derived,
    focusedState,
    focusedStateCode,
    quoteMode,
    quoteNotes,
    setQuoteNotes,
    requestedDate,
    setRequestedDate,
    quoteOptions,
    resetFilters,
    setNiche,
    toggleAgeBucket,
    setTimezone,
    setRequestedQuantity,
    focusState,
    toggleSelection,
    openQuote,
    closeQuote,
    toggleQuoteOption,
    capabilities: model.capabilities,
  };
}

export type InventoryExplorerLocalState = ReturnType<
  typeof useInventoryExplorerState
>;
