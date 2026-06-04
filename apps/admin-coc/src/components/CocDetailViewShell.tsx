"use client";

import type { ReactNode } from "react";

import { DetailOverlay } from "@/components/DetailOverlay";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isCocDetailOverlayEnabled } from "@/lib/coc-detail-overlay-config";
import { useCocDetailViewMode } from "@/lib/use-coc-detail-view-mode";
import { cn } from "@/lib/utils";

export type CocDetailViewShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Legacy SheetContent classes when overlay flag is off. */
  sheetClassName?: string;
  /** Scrollable body classes (overlay + legacy sheet body). */
  bodyClassName?: string;
  /** When false, legacy sheet keeps its built-in close button (default true). */
  showSheetCloseButton?: boolean;
};

const LEGACY_DOCKED_SHEET =
  "flex h-full max-h-screen w-[min(720px,calc(100vw-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-none";

/**
 * Feature-flagged detail container: DetailOverlay when enabled, unchanged Sheet drawer when disabled.
 */
export function CocDetailViewShell({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  sheetClassName,
  bodyClassName,
  showSheetCloseButton = true,
}: CocDetailViewShellProps) {
  const overlayEnabled = isCocDetailOverlayEnabled();
  const { mode, setMode } = useCocDetailViewMode();

  if (!overlayEnabled) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className={sheetClassName ?? LEGACY_DOCKED_SHEET}
          showCloseButton={showSheetCloseButton}
        >
          <SheetHeader className="sticky top-0 z-10 shrink-0 space-y-1 border-b border-border bg-background px-5 py-4 pr-14 text-left">
            <SheetTitle>{title}</SheetTitle>
            {subtitle ? <SheetDescription className="text-left">{subtitle}</SheetDescription> : null}
          </SheetHeader>
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-5 py-4",
              footer ? "pb-4" : "pb-12",
              bodyClassName
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="sticky bottom-0 shrink-0 border-t border-border bg-background px-5 py-4">
              {footer}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DetailOverlay
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      footer={footer}
      mode={mode}
      onModeChange={setMode}
      bodyClassName={bodyClassName}
    >
      {children}
    </DetailOverlay>
  );
}
