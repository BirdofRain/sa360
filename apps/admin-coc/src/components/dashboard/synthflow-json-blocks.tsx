"use client";

import { useCallback, useState } from "react";

import type { AdminSynthflowDetail } from "@/lib/admin-api/types";
import { Button } from "@/components/ui/button";

function stringifyJson(value: unknown): string {
  try {
    if (value === undefined || value === null) {
      return "—";
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function JsonPre({
  value,
  title,
  showCopy,
}: {
  value: unknown;
  title: string;
  /** When true, shows a small button to copy the formatted JSON text to the clipboard. */
  showCopy?: boolean;
}) {
  const text = stringifyJson(value);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (text === "—") {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-600">{title}</div>
        {showCopy && text !== "—" ? (
          <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={handleCopy}>
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        ) : null}
      </div>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-5 text-slate-800 dark:text-slate-200">
        {text}
      </pre>
    </div>
  );
}

/** Synthflow inbound payloads often nest under `call_inbound`. */
export function extractCallInboundParts(body: unknown): {
  metadata: unknown;
  customVariables: unknown;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { metadata: undefined, customVariables: undefined };
  }
  const root = body as Record<string, unknown>;
  const ci = root.call_inbound;
  if (!ci || typeof ci !== "object" || Array.isArray(ci)) {
    return { metadata: undefined, customVariables: undefined };
  }
  const cin = ci as Record<string, unknown>;
  return {
    metadata: cin.metadata,
    customVariables: cin.custom_variables,
  };
}

export function SynthflowDetailPayloadSections({ detail }: { detail: AdminSynthflowDetail }) {
  const reqParts = extractCallInboundParts(detail.requestBodyRedacted);
  const resParts = extractCallInboundParts(detail.responseBodyRedacted);

  return (
    <div className="space-y-4">
      {detail.errorSummary ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="font-medium">error_summary: </span>
          {detail.errorSummary}
        </div>
      ) : null}
      <JsonPre value={detail.requestBodyRedacted} title="requestBodyRedacted (full)" showCopy />
      <JsonPre value={detail.responseBodyRedacted} title="responseBodyRedacted (full)" />
      {(reqParts.metadata !== undefined || resParts.metadata !== undefined) && (
        <JsonPre
          value={reqParts.metadata ?? resParts.metadata}
          title="metadata (from call_inbound if present)"
        />
      )}
      {(reqParts.customVariables !== undefined || resParts.customVariables !== undefined) && (
        <JsonPre
          value={reqParts.customVariables ?? resParts.customVariables}
          title="custom_variables (from call_inbound if present)"
        />
      )}
    </div>
  );
}
