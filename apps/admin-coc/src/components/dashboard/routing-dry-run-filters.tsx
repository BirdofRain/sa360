"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildRoutingDryRunHref,
  parseRoutingDryRunSearchParams,
  routingDryRunCleanHref,
  type RoutingDryRunLimit,
  type RoutingDryRunMatchedFilter,
  type RoutingDryRunQuery,
  type RoutingDryRunReviewQueueFilter,
} from "@/lib/routing-dry-run/routing-dry-run-query";
import { ROUTING_VALIDATION_STATUS_OPTIONS } from "@/lib/routing-dry-run/routing-dry-run-validation-display";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const ALL_MASTERS_VALUE = "";
const CUSTOM_MASTER_VALUE = "__custom__";

function resolveInitialMasterSelect(
  master: string,
  options: string[]
): { select: string; custom: string } {
  const trimmed = master.trim();
  if (!trimmed) return { select: ALL_MASTERS_VALUE, custom: "" };
  if (options.includes(trimmed)) return { select: trimmed, custom: "" };
  return { select: CUSTOM_MASTER_VALUE, custom: trimmed };
}

type Props = {
  initial: RoutingDryRunQuery;
  masterClientOptions: string[];
};

export function RoutingDryRunFilters({ initial, masterClientOptions }: Props) {
  const router = useRouter();
  const initialMaster = resolveInitialMasterSelect(
    initial.masterClientAccountId,
    masterClientOptions
  );
  const [masterSelect, setMasterSelect] = useState(initialMaster.select);
  const [customMaster, setCustomMaster] = useState(initialMaster.custom);

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const master =
      masterSelect === CUSTOM_MASTER_VALUE
        ? customMaster.trim()
        : masterSelect.trim();
    const matched = String(fd.get("matched") ?? "all") as RoutingDryRunMatchedFilter;
    const limit = Number(String(fd.get("limit") ?? "50")) as RoutingDryRunLimit;
    const reviewQueue = String(fd.get("reviewQueue") ?? "all") as RoutingDryRunReviewQueueFilter;
    const parsed = parseRoutingDryRunSearchParams({
      masterClientAccountId: master,
      matched,
      validationStatus: String(fd.get("validationStatus") ?? "all"),
      reviewQueue,
      limit: String(limit),
    });
    router.push(
      buildRoutingDryRunHref({
        masterClientAccountId: master,
        matched: matched === "matched" || matched === "unmatched" ? matched : "all",
        validationStatus: parsed.validationStatus,
        reviewQueue: parsed.reviewQueue,
        limit:
          limit === 5 || limit === 25 || limit === 50 || limit === 100 ? limit : 50,
        safeMode: initial.safeMode,
      })
    );
  }

  return (
    <form onSubmit={onApply} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[240px] flex-1 gap-2">
          <Label htmlFor="rdr-master-select">Master client / lead source</Label>
          <select
            id="rdr-master-select"
            className={selectClass}
            value={masterSelect}
            onChange={(e) => setMasterSelect(e.target.value)}
          >
            <option value={ALL_MASTERS_VALUE}>All master clients</option>
            {masterClientOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            <option value={CUSTOM_MASTER_VALUE}>Custom ID…</option>
          </select>
        </div>
        {masterSelect === CUSTOM_MASTER_VALUE ? (
          <div className="grid min-w-[200px] flex-1 gap-2">
            <Label htmlFor="rdr-master-custom">Custom master ID</Label>
            <Input
              id="rdr-master-custom"
              placeholder="master_client_account_id"
              value={customMaster}
              onChange={(e) => setCustomMaster(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : null}
        <div className="grid w-full max-w-[200px] gap-2">
          <Label htmlFor="rdr-matched">Match status</Label>
          <select id="rdr-matched" name="matched" className={selectClass} defaultValue={initial.matched}>
            <option value="all">All</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Review required / unmatched</option>
          </select>
        </div>
        <div className="grid w-full max-w-[220px] gap-2">
          <Label htmlFor="rdr-validation">Validation status</Label>
          <select
            id="rdr-validation"
            name="validationStatus"
            className={selectClass}
            defaultValue={initial.validationStatus}
          >
            {ROUTING_VALIDATION_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid w-full max-w-[240px] gap-2">
          <Label htmlFor="rdr-queue">Review queue</Label>
          <select
            id="rdr-queue"
            name="reviewQueue"
            className={selectClass}
            defaultValue={initial.reviewQueue}
          >
            <option value="all">All queues</option>
            <option value="unreviewed_only">Unreviewed only</option>
            <option value="mismatches">Mismatches</option>
            <option value="needs_mapping">Needs mapping</option>
            <option value="matched_no_plan">Matched, no delivery plan</option>
            <option value="matched_needs_config_plan">Matched, plan needs config</option>
          </select>
        </div>
        <div className="grid w-full max-w-[120px] gap-2">
          <Label htmlFor="rdr-limit">Limit</Label>
          <select id="rdr-limit" name="limit" className={selectClass} defaultValue={String(initial.limit)}>
            {initial.safeMode ? <option value="5">5</option> : null}
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 pb-0.5">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="outline" onClick={() => router.push(buildRoutingDryRunHref(initial))}>
            Refresh
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(routingDryRunCleanHref())}>
            Open clean filter
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Default is all master clients. Global stats appear only when a specific master is selected.
      </p>
    </form>
  );
}
