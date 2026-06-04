"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Maximize2, PanelRight, XIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { CocDetailViewMode } from "@/lib/coc-detail-overlay-config";
import { cn } from "@/lib/utils";

export type DetailOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  mode?: CocDetailViewMode;
  onModeChange?: (mode: CocDetailViewMode) => void;
  closeLabel?: string;
  bodyClassName?: string;
};

export function DetailOverlay({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  mode = "overlay",
  onModeChange,
  closeLabel = "Close detail view",
  bodyClassName,
}: DetailOverlayProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isDocked = mode === "docked";
  const showModeToggle = Boolean(onModeChange);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-testid="detail-overlay-backdrop"
          className="fixed inset-0 z-[60] bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-[2px]"
          onClick={() => onOpenChange(false)}
        />
        <DialogPrimitive.Popup
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          data-mode={mode}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "fixed z-[61] flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-lg outline-none",
            isDocked
              ? "inset-y-0 right-0 h-full w-[min(720px,calc(100vw-32px))] rounded-none border-l data-ending-style:translate-x-8 data-starting-style:translate-x-8"
              : "left-1/2 top-1/2 max-h-[calc(100vh-48px)] w-[min(1120px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-xl data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            "transition duration-200 ease-out"
          )}
          style={
            isDocked
              ? undefined
              : { height: "min(860px, calc(100vh - 48px))", maxHeight: "calc(100vh - 48px)" }
          }
        >
          <header className="sticky top-0 z-10 flex shrink-0 items-start gap-3 border-b border-border bg-popover px-5 py-4">
            <div className="min-w-0 flex-1 space-y-1 pr-2 text-left">
              {title ? (
                <DialogPrimitive.Title
                  id={titleId}
                  className="font-heading text-base font-medium leading-snug text-foreground"
                >
                  {title}
                </DialogPrimitive.Title>
              ) : null}
              {subtitle ? (
                <DialogPrimitive.Description className="text-left text-sm text-muted-foreground">
                  {subtitle}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {showModeToggle ? (
                isDocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onModeChange?.("overlay")}
                  >
                    <Maximize2 className="size-4" aria-hidden />
                    Expand
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onModeChange?.("docked")}
                  >
                    <PanelRight className="size-4" aria-hidden />
                    Dock to side
                  </Button>
                )
              ) : null}
              <Button
                ref={closeRef}
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                aria-label={closeLabel}
                onClick={() => onOpenChange(false)}
              >
                <XIcon className="size-5" aria-hidden />
              </Button>
            </div>
          </header>

          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4",
              bodyClassName
            )}
          >
            {children}
          </div>

          {footer ? (
            <footer className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-popover px-5 py-4">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
