"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ATTRIBUTION_FIELDS,
  COMPLIANCE_FIELDS,
  compareDraftMapping,
  confidenceBadgeLabel,
  detectCanonicalConflicts,
  extractSampleValues,
  fieldLabel,
  IDENTITY_FIELDS,
  isCustomAttributeTarget,
  isReservedCustomKey,
  LEAD_DETAIL_FIELDS,
  MAPPING_CUSTOM_PREFIX,
  MAPPING_IGNORE,
  MAPPING_UNMAPPED,
  buildCustomTarget,
  mappingRowStatus,
  statusLabelText,
  summarizeMapping,
  type MappingChangeImpactPreview,
  type MappingSuggestion,
  type PreviewRow,
} from "@/lib/bulk-imports/mapping-editor";
import type { BulkImportWizardStep } from "@/lib/bulk-imports/types";
import {
  BulkImportConfirmDialog,
  BULK_IMPORT_RESET_CONFIRMATION,
} from "@/components/bulk-imports/bulk-import-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SaveBulkImportMappingResult =
  | { ok: true; mappingChanged: boolean; resetPerformed: boolean; nextStep?: string }
  | {
      ok: false;
      message: string;
      resetRequired?: boolean;
      impact?: MappingChangeImpactPreview;
    };

type Props = {
  headers: string[];
  suggestions: MappingSuggestion[];
  previewRows: PreviewRow[];
  savedMapping: Record<string, string>;
  missingRequired: string[];
  destinationClientAccountId?: string | null;
  destinationLocationIdGhl?: string | null;
  hasDownstreamArtifacts: boolean;
  initialMode?: "view" | "edit";
  returnStep?: BulkImportWizardStep;
  loading?: boolean;
  onSave: (
    mapping: Record<string, string>,
    options?: { templateName?: string; resetConfirmation?: string }
  ) => Promise<SaveBulkImportMappingResult>;
  onReturnToStep?: () => void;
};

const CREATE_CUSTOM = "__create_custom__";

function targetSelectValue(target: string): string {
  if (isCustomAttributeTarget(target)) return target;
  return target;
}

function changeSummaryLines(summary: {
  remappedColumns: number;
  toPreserveColumns: number;
  toIgnoreColumns: number;
  missingRequired: number;
}): string[] {
  return [
    `${summary.remappedColumns} column(s) remapped`,
    `${summary.toPreserveColumns} column(s) changed to Preserve`,
    `${summary.toIgnoreColumns} column(s) changed to Ignore`,
    `${summary.missingRequired} required mapping(s) missing`,
  ];
}

export function BulkImportMappingEditor({
  headers,
  suggestions,
  previewRows,
  savedMapping,
  missingRequired,
  destinationClientAccountId,
  destinationLocationIdGhl,
  hasDownstreamArtifacts,
  initialMode = "view",
  returnStep,
  loading,
  onSave,
  onReturnToStep,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [draftMapping, setDraftMapping] = useState<Record<string, string>>(savedMapping);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [customDraft, setCustomDraft] = useState<{
    csvColumn: string;
    label: string;
    key: string;
  } | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [pendingImpact, setPendingImpact] = useState<MappingChangeImpactPreview | null>(null);
  const [saving, setSaving] = useState(false);

  const activeMapping = mode === "view" ? savedMapping : draftMapping;

  useEffect(() => {
    setDraftMapping(savedMapping);
  }, [savedMapping]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, savedMapping]);

  const suggestionByColumn = useMemo(
    () => Object.fromEntries(suggestions.map((s) => [s.csvColumn, s])),
    [suggestions]
  );

  const comparison = useMemo(
    () => compareDraftMapping(savedMapping, draftMapping, headers),
    [savedMapping, draftMapping, headers]
  );

  const conflicts = useMemo(() => detectCanonicalConflicts(activeMapping), [activeMapping]);
  const conflictTargets = useMemo(
    () => new Set(conflicts.map((c) => c.canonical)),
    [conflicts]
  );
  const missingSet = useMemo(() => new Set(missingRequired), [missingRequired]);
  const counts = useMemo(() => summarizeMapping(activeMapping), [activeMapping]);

  const nameMapped =
    !missingSet.has("name") &&
    Object.values(activeMapping).some((t) =>
      ["first_name", "last_name", "full_name"].includes(t)
    );
  const phoneMapped = !missingSet.has("phone");

  const hasUnsavedChanges =
    mode === "edit" && comparison.mappingChanged;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  const controlsDisabled = mode === "view" || saving || loading;

  function setColumnTarget(csvColumn: string, value: string) {
    if (controlsDisabled) return;
    if (value === CREATE_CUSTOM) {
      setCustomDraft({ csvColumn, label: "", key: "" });
      setCustomError(null);
      return;
    }
    setDraftMapping((prev) => ({ ...prev, [csvColumn]: value }));
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
    setDraftMapping((prev) => ({
      ...prev,
      [customDraft.csvColumn]: buildCustomTarget(key),
    }));
    setCustomDraft(null);
    setCustomError(null);
  }

  const hasBlockingIssues =
    missingRequired.length > 0 || detectCanonicalConflicts(draftMapping).length > 0;

  const submitSave = useCallback(
    async (resetConfirmation?: string) => {
      setSaving(true);
      setMessage(null);
      setResetError(null);
      const result = await onSave(draftMapping, {
        templateName: templateName.trim() || undefined,
        resetConfirmation,
      });
      setSaving(false);

      if (!result.ok) {
        if (result.resetRequired && result.impact) {
          setPendingImpact(result.impact);
          setResetDialogOpen(true);
          return;
        }
        setResetError(result.message);
        if (resetDialogOpen) setResetError(result.message);
        else setMessage(result.message);
        return;
      }

      setResetDialogOpen(false);
      setResetConfirmText("");
      setPendingImpact(null);

      if (!result.mappingChanged) {
        setMessage("No mapping changes to save.");
        setMode("view");
        return;
      }

      if (result.resetPerformed) {
        setMessage("Mapping saved. Normalize the rows again to apply the new mapping.");
      } else {
        setMessage("Mapping saved.");
      }
      setMode("view");
    },
    [draftMapping, onSave, resetDialogOpen, templateName]
  );

  async function handleSaveClick() {
    if (!comparison.mappingChanged) {
      setMessage("No mapping changes to save.");
      setMode("view");
      return;
    }
    if (hasDownstreamArtifacts) {
      await submitSave();
      return;
    }
    await submitSave();
  }

  function discardChanges() {
    setDraftMapping(savedMapping);
    setMessage(null);
    setMode("view");
  }

  const bannerText =
    mode === "view"
      ? "Viewing the saved mapping. No data has been changed."
      : hasDownstreamArtifacts
        ? "Saving mapping changes will rebuild this import's Source Intake records. Nothing in GHL will be changed."
        : "Changes will apply the next time these rows are normalized.";

  return (
    <div className="space-y-6">
      <div
        className={`rounded-lg border p-3 text-sm ${
          mode === "view" ? "bg-muted/30" : "bg-amber-50 border-amber-200 text-amber-950"
        }`}
      >
        {bannerText}
      </div>

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
              const target = activeMapping[header] ?? MAPPING_UNMAPPED;
              const samples = extractSampleValues(previewRows, header, showFullPreview);
              const isConflict = conflictTargets.has(target);
              const status = mappingRowStatus(target, isConflict, missingSet);
              const suggestedLabel = suggestion?.suggestedCanonical
                ? fieldLabel(suggestion.suggestedCanonical)
                : "—";

              return (
                <tr key={header} className="border-t align-top">
                  <td className="px-3 py-2 font-mono text-xs break-all">{header}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {samples.length ? samples.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div>{suggestedLabel}</div>
                    {suggestion?.suggestedCanonical ? (
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {suggestion.suggestedCanonical}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {confidenceBadgeLabel(suggestion, header)}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <select
                      className="w-full rounded border bg-background px-2 py-1 text-sm disabled:opacity-60"
                      value={targetSelectValue(target)}
                      disabled={controlsDisabled}
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
                      {mode === "edit" ? (
                        <option value={CREATE_CUSTOM}>Create custom SA360 source attribute…</option>
                      ) : null}
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
        {mode === "edit" && comparison.mappingChanged ? (
          <div className="pt-2 border-t text-xs text-muted-foreground space-y-0.5">
            {changeSummaryLines(comparison.changeSummary).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="template-name">
              Save as mapping template (optional)
            </label>
            <Input
              id="template-name"
              value={templateName}
              disabled={saving || loading}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
            />
          </div>
          <Button
            disabled={saving || loading || hasBlockingIssues}
            onClick={() => void handleSaveClick()}
          >
            {saving || loading ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" disabled={saving || loading} onClick={discardChanges}>
            Discard changes
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMode("edit")}>
            Edit mapping
          </Button>
          {returnStep && onReturnToStep ? (
            <Button variant="outline" onClick={onReturnToStep}>
              Return to {returnStep}
            </Button>
          ) : null}
        </div>
      )}

      {message ? <p className="text-sm text-green-700">{message}</p> : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Advanced → View mapping JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded border p-2 text-xs break-all">
          {JSON.stringify(activeMapping, null, 2)}
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

      <BulkImportConfirmDialog
        open={resetDialogOpen}
        title="Apply mapping changes and rebuild normalized rows?"
        description={
          <p>
            These mapping changes alter how CSV rows are normalized. SA360 must remove the existing
            normalized Source Intake records and simulation results, then normalize the rows again.
            Nothing in GHL will be deleted or modified.
          </p>
        }
        details={
          pendingImpact ? (
            <>
              <p>
                Mapping changes:{" "}
                {(pendingImpact.changeSummary?.remappedColumns ?? 0) +
                  (pendingImpact.changeSummary?.toPreserveColumns ?? 0) +
                  (pendingImpact.changeSummary?.toIgnoreColumns ?? 0)}
              </p>
              <p>Source Intake records to rebuild: {pendingImpact.sourceLeadEventsToRemove}</p>
              <p>Simulation results to clear: {pendingImpact.simulationArtifactsToRemove}</p>
              <p>GHL records affected: {pendingImpact.deliveredRows}</p>
              <p>
                Destination preserved: {pendingImpact.destinationWillBePreserved ? "Yes" : "No"}
              </p>
            </>
          ) : null
        }
        requiredPhrase={BULK_IMPORT_RESET_CONFIRMATION}
        confirmLabel="Save mapping and reset"
        loading={saving}
        loadingLabel="Saving mapping and resetting…"
        error={resetError}
        confirmationValue={resetConfirmText}
        onConfirmationChange={setResetConfirmText}
        destructive
        onCancel={() => {
          if (saving) return;
          setResetDialogOpen(false);
          setResetConfirmText("");
          setResetError(null);
          setPendingImpact(null);
        }}
        onConfirm={() => void submitSave(resetConfirmText)}
      />
    </div>
  );
}
