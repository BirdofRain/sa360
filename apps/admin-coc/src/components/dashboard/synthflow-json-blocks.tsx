import type { AdminSynthflowDetail } from "@/lib/admin-api/types";

function JsonPre({ value, title }: { value: unknown; title: string }) {
  let text = "—";
  try {
    text =
      value === undefined || value === null
        ? "—"
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">{title}</div>
      <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-800">
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
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <span className="font-medium">error_summary: </span>
          {detail.errorSummary}
        </div>
      ) : null}
      <JsonPre value={detail.requestBodyRedacted} title="requestBodyRedacted (full)" />
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
