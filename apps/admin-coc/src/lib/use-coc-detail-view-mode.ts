"use client";

import { useCallback, useEffect, useState } from "react";

import {
  defaultCocDetailViewMode,
  readStoredCocDetailViewMode,
  type CocDetailViewMode,
  writeStoredCocDetailViewMode,
} from "@/lib/coc-detail-overlay-config";

export function useCocDetailViewMode(): {
  mode: CocDetailViewMode;
  setMode: (mode: CocDetailViewMode) => void;
} {
  const [mode, setModeState] = useState<CocDetailViewMode>(defaultCocDetailViewMode);

  useEffect(() => {
    const stored = readStoredCocDetailViewMode();
    if (stored) setModeState(stored);
  }, []);

  const setMode = useCallback((next: CocDetailViewMode) => {
    setModeState(next);
    writeStoredCocDetailViewMode(next);
  }, []);

  return { mode, setMode };
}
