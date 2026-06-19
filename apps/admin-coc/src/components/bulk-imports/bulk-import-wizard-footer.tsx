"use client";

import { Button } from "@/components/ui/button";
import type { BulkImportWizardStep } from "@/lib/bulk-imports/types";
import type { WizardFooterConfig } from "@/lib/bulk-imports/wizard-footer-config";

type Props = {
  config: WizardFooterConfig;
  viewStep: BulkImportWizardStep;
  loading?: boolean;
  onPrevious?: () => void;
  onPrimary: () => void;
  statusText?: string | null;
};

export function BulkImportWizardFooter({
  config,
  viewStep,
  loading,
  onPrevious,
  onPrimary,
  statusText,
}: Props) {
  if (config.primaryAction === "none" && !config.previousViewStep) {
    return null;
  }

  return (
    <div
      className="sticky bottom-0 z-10 -mx-1 mt-6 border-t bg-background/95 px-1 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-testid={`wizard-footer-${viewStep}`}
    >
      {statusText ? (
        <p className="mb-3 text-sm text-muted-foreground">{statusText}</p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full sm:w-auto">
          {config.previousViewStep && onPrevious ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={loading}
              onClick={onPrevious}
            >
              {config.previousLabel ?? "← Previous"}
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
        </div>
        {config.primaryAction !== "none" ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={config.primaryDisabled}
            onClick={onPrimary}
          >
            {config.primaryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
