"use client";

import { useMemo, useState } from "react";

import { isTerritoryInteractive } from "./display";
import type {
  MapViewMode,
  PipelineStudioDestination,
  PipelineStudioReadModel,
  PipelineStudioTerritory,
} from "./types";

export type ConfigTab = "destinations" | "rules" | "settings";

export function usePipelineStudioState(model: PipelineStudioReadModel) {
  const [territories, setTerritories] = useState<PipelineStudioTerritory[]>(
    () => model.territories.map((t) => ({ ...t, ageBuckets: t.ageBuckets.map((b) => ({ ...b })) }))
  );
  const [destinations, setDestinations] = useState<PipelineStudioDestination[]>(
    () => model.destinations.map((d) => ({ ...d }))
  );
  const [selectedTerritoryCode, setSelectedTerritoryCode] = useState<string | null>(
    () => model.territories.find((t) => t.selected)?.stateCode ?? null
  );
  const [territoryQuery, setTerritoryQuery] = useState("");
  const [configTab, setConfigTab] = useState<ConfigTab>("destinations");
  const [mapView, setMapView] = useState<MapViewMode>("states");
  const [zoom, setZoom] = useState(1);

  const selectedCount = useMemo(
    () => territories.filter((t) => t.selected && isTerritoryInteractive(t)).length,
    [territories]
  );

  const filteredTerritories = useMemo(() => {
    const q = territoryQuery.trim().toLowerCase();
    if (!q) return territories;
    return territories.filter(
      (t) =>
        t.stateCode.toLowerCase().includes(q) ||
        t.stateName.toLowerCase().includes(q)
    );
  }, [territories, territoryQuery]);

  function toggleTerritory(stateCode: string) {
    setTerritories((prev) =>
      prev.map((t) => {
        if (t.stateCode !== stateCode || !isTerritoryInteractive(t)) return t;
        return { ...t, selected: !t.selected };
      })
    );
    setSelectedTerritoryCode(stateCode);
  }

  function selectAllEnabled() {
    setTerritories((prev) =>
      prev.map((t) =>
        isTerritoryInteractive(t) ? { ...t, selected: true } : t
      )
    );
  }

  function toggleDestination(id: string) {
    if (!model.capabilities.canModifyDestinations) return;
    setDestinations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, enabled: !d.enabled } : d))
    );
  }

  function zoomIn() {
    setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))));
  }

  function zoomOut() {
    setZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))));
  }

  function resetView() {
    setZoom(1);
    setMapView("states");
  }

  return {
    territories,
    destinations,
    selectedTerritoryCode,
    setSelectedTerritoryCode,
    territoryQuery,
    setTerritoryQuery,
    configTab,
    setConfigTab,
    mapView,
    setMapView,
    zoom,
    selectedCount,
    filteredTerritories,
    toggleTerritory,
    selectAllEnabled,
    toggleDestination,
    zoomIn,
    zoomOut,
    resetView,
    capabilities: model.capabilities,
  };
}

export type PipelineStudioLocalState = ReturnType<typeof usePipelineStudioState>;
