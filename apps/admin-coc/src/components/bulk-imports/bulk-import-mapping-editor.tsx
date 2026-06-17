"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ALL_STANDARD_FIELDS,
  ATTRIBUTION_FIELDS,
  COMPLIANCE_FIELDS,
  IDENTITY_FIELDS,
  LEAD_DETAIL_FIELDS,
  MAPPING_CUSTOM_PREFIX,
  MAPPING_IGNORE,
  MAPPING_UNMAPPED,
  buildCustomTarget,
  confidenceBadgeLabel,
  detectCanonicalConflicts,
  extractSampleValues,
  fieldLabel,
  isCustomAttributeTarget,
  isReservedCustomKey,
  mappingRowStatus,
  statusLabelText,
  summarizeMapping,
  type MappingSuggestion,
  type PreviewRow,
} from "@/lib/bulk-imports/mapping-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  headers: string[];
  suggestions: MappingSuggestion[];
  previewRows: PreviewRow[];
  initialMapping: Record<string, string>;
  missingRequired: string[];
  destinationClientAccountId?: string | null;
  destinationLocationIdGhl?: string | null;
  loading?: boolean;
  onSave: (mapping: Record<string, string>, templateName?: string) => Promise<boolean>;
};

const CREATE_CUSTOM = "__create_custom__";

function targetSelectValue(target: string): string {
  if (isCustomAttributeTarget(target)) return target;
  return target;
}

export function BulkImportMappingEditor({
  headers,
  suggestions,
  previewRows,
  initialMapping,
  missingRequired,
  destinationClientAccountId,
  destinationLocationIdGhl,
  loading,
  onSave,
}: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [customDraft, setCustomDraft] = useState<{
    csvColumn: string;
    label: string;
    key: string;
  } | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  const suggestionByColumn = useMemo(
    () => Object.fromEntries(suggestions.map((s) => [s.csvColumn, s])),
    [suggestions]
  );

  const conflicts = useMemo(() => detectCanonicalConflicts(mapping), [mapping]);
  const conflictTargets = useMemo(
    () => new Set(conflicts.map((c) => c.canonical)),
    [conflicts]
  );
  const missingSet = useMemo(() => new Set(missingRequired), [missingRequired]);
  const counts = useMemo(() => summarizeMapping(mapping), [mapping]);

  const nameMapped =
    !missingSet.has("name") &&
    Object.values(mapping).some((t) =>
      ["first_name", "last_name", "full_name"].includes(t)
    );
  const phoneMapped = !missingSet.has("phone");

  function setColumnTarget(csvColumn: string, value: string) {
    if (value === CREATE_CUSTOM) {
      setCustomDraft({ csvColumn, label: "", key: "" });
      setCustomError(null);
      return;
    }
    setMapping((prev) => ({ ...prev, [csvColumn]: value }));
  }

  function applyCustomAttribute() {
    if (!customDraft) return;
    const key = customDraft.key.trim();
    if (!key) {
      setCustomError("Stable key is required.");
      return;
    }
    if (isReservedCustomKey(key)) {
      setCustomError("This key is reserved for a standard SA360 field.");
      return;
    }
    setMapping((prev) => ({
      ...prev,
      [customDraft.csvColumn]: buildCustomTarget(key),
    }));
    setCustomDraft(null);
    setCustomError(null);
  }

  const hasBlockingIssues =
    missingRequired.length > 0 || conflicts.length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
        <p>
          CSV mapping defines how SA360 stores and normalizes incoming data. Mapping or creating a
          GHL custom field is handled separately after selecting a destination.
        </p>
        <p className="text-muted-foreground">
          Stored in SA360. Not written to GHL unless mapped in the destination configuration.
        </p>
        {destinationClientAccountId && destinationLocationIdGhl ? (
          <Link
            className="text-primary underline"
            href={`/clients/${destinationClientAccountId}/delivery-config?locationId=${encodeURIComponent(destinationLocationIdGhl)}`}
          >
            Configure destination source-field mappings
          </Link>
        ) : null}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium">Identity requirements</h3>
        <ul className="text-sm space-y-1">
          <li>{nameMapped ? "✓" : "✕"} Name (first/last or full name)</li>
          <li>{phoneMapped ? "✓" : "✕"} Phone</li>
          <li>✓ Source lead ID optional — SA360 generates a stable ID when not mapped</li>
        </ul>
        {missingRequired.length > 0 ? (
          <p className="text-sm text-amber-800">
            Missing required mappings: {missingRequired.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">CSV column</th>
              <th className="px-3 py-2">Sample values</th>
              <th className="px-3 py-2">Suggested destination</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Mapping action</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header) => {
              const suggestion = suggestionByColumn[header];
              const target = mapping[header] ?? MAPPING_UNMAPPED;
              const samples = extractSampleValues(previewRows, header, showFullPreview);
              const isConflict = conflictTargets.has(target);
              const status = mappingRowStatus(target, isConflict, missingSet);
              const suggestedLabel = suggestion?.suggestedCanonical
                ? fieldLabel(suggestion.suggestedCanonical)
                : "—";

              return (
                <tr key={header} className="border-t align-top">
                  <td className="px-3 py-2 font-mono text-xs">{header}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {samples.length ? samples.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div>{suggestedLabel}</div>
                    {suggestion?.suggestedCanonical ? (
                      <div className="text-xs text-muted-foreground font-mono">
                        {suggestion.suggestedCanonical}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {confidenceBadgeLabel(suggestion, header)}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <select
                      className="w-full rounded border bg-background px-2 py-1 text-sm"
                      value={targetSelectValue(target)}
                      onChange={(e) => setColumnTarget(header, e.target.value)}
                    >
                      <optgroup label="Identity">
                        {IDENTITY_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabel(f)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Lead details">
                        {LEAD_DETAIL_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabel(f)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Attribution">
                        {ATTRIBUTION_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabel(f)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Compliance / source">
                        {COMPLIANCE_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabel(f)}
                          </option>
                        ))}
                      </optgroup>
                      <option value={MAPPING_UNMAPPED}>Preserve as source attribute</option>
                      <option value={MAPPING_IGNORE}>Ignore column</option>
                      <option value={CREATE_CUSTOM}>Create custom SA360 source attribute…</option>
                      {isCustomAttributeTarget(target) ? (
                        <option value={target}>
                          Custom: {target.slice(MAPPING_CUSTOM_PREFIX.length)}
                        </option>
                      ) : null}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs">{statusLabelText(status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showFullPreview}
          onChange={(e) => setShowFullPreview(e.target.checked)}
        />
        Show full preview (internal admin)
      </label>

      {conflicts.map((conflict) => (
        <p key={conflict.canonical} className="text-sm text-amber-800">
          Two CSV columns map to {fieldLabel(conflict.canonical.replace(/^custom:/, ""))} (
          {conflict.csvColumns.join(", ")}). Choose one primary source or set the other to
          Preserve/Ignore.
        </p>
      ))}

      <div className="rounded border p-3 text-sm space-y-1">
        <p>Standard fields mapped: {counts.standardMapped}</p>
        <p>Custom attributes: {counts.customAttributes}</p>
        <p>Preserved columns: {counts.preserved}</p>
        <p>Ignored columns: {counts.ignored}</p>
        <p>Missing required: {missingRequired.length}</p>
        <p>Conflicts: {conflicts.length}</p>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="template-name">
            Save as mapping template (optional)
          </label>
          <Input
            id="template-name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name"
          />
        </div>
        <Button
          disabled={loading || hasBlockingIssues}
          onClick={() => void onSave(mapping, templateName.trim() || undefined)}
        >
          {loading ? "Saving…" : "Save mapping & continue"}
        </Button>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">Advanced → View mapping JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded border p-2 text-xs">
          {JSON.stringify(mapping, null, 2)}
        </pre>
      </details>

      {customDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-4 space-y-3">
            <p className="font-medium">Custom SA360 source attribute</p>
            <p className="text-sm text-muted-foreground">Column: {customDraft.csvColumn}</p>
            <Input
              placeholder="Display label"
              value={customDraft.label}
              onChange={(e) => setCustomDraft({ ...customDraft, label: e.target.value })}
            />
            <Input
              placeholder="Stable key (e.g. preferred_language)"
              value={customDraft.key}
              onChange={(e) => setCustomDraft({ ...customDraft, key: e.target.value })}
            />
            {customError ? <p className="text-sm text-destructive">{customError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCustomDraft(null)}>
                Cancel
              </Button>
              <Button onClick={applyCustomAttribute}>Apply</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
