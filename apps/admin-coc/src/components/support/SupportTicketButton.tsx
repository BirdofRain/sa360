"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronDown, LifeBuoy, Loader2, XIcon } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";

import { createSupportTicketAction } from "@/app/actions/support-tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { captureSupportPageContext } from "@/lib/support-tickets/capture-context";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  type SupportTicketContextOverride,
} from "@/lib/support-tickets/types";
import { cn } from "@/lib/utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SupportTicketModal({
  open,
  onOpenChange,
  contextOverride,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextOverride?: SupportTicketContextOverride;
}) {
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("GENERAL");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTicketNumber, setSuccessTicketNumber] = useState<number | null>(null);

  const reset = useCallback(() => {
    setDescription("");
    setSubject("");
    setCategory("GENERAL");
    setPriority("NORMAL");
    setRequesterName("");
    setRequesterEmail("");
    setShowAdvanced(false);
    setError(null);
    setSuccessTicketNumber(null);
    setPending(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Please tell us what’s going on.");
      return;
    }
    setPending(true);
    const ctx = captureSupportPageContext(contextOverride);
    const res = await createSupportTicketAction({
      description: trimmed,
      subject: subject.trim() || undefined,
      category: category as (typeof SUPPORT_TICKET_CATEGORIES)[number],
      priority: priority as (typeof SUPPORT_TICKET_PRIORITIES)[number],
      requesterName: requesterName.trim() || undefined,
      requesterEmail: requesterEmail.trim() || undefined,
      ...ctx,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSuccessTicketNumber(res.ticketNumber);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[70] bg-black/40 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-ticket-title"
          className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(640px,calc(100vh-48px))] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg outline-none"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <DialogPrimitive.Title
                id="support-ticket-title"
                className="font-heading text-base font-medium text-foreground"
              >
                Report an issue
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                Send a quick note to the SA360 team. We’ll automatically include the page you’re on so
                you don’t have to explain everything.
              </DialogPrimitive.Description>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              aria-label="Close support form"
              onClick={() => handleOpenChange(false)}
            >
              <XIcon className="size-5" aria-hidden />
            </Button>
          </header>

          {successTicketNumber != null ? (
            <div className="space-y-4 px-5 py-6">
              <p className="text-sm font-medium text-foreground">
                Ticket #{successTicketNumber} created
              </p>
              <p className="text-sm text-muted-foreground">
                The team can follow up from the Support Tickets queue. You can close this dialog.
              </p>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="space-y-2">
                  <Label htmlFor="support-description">What&apos;s going on?</Label>
                  <textarea
                    id="support-description"
                    required
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell us what broke, what looks wrong, or what you were trying to do…"
                    className={cn(
                      "flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                      "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  />
                </div>

                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", showAdvanced && "rotate-180")}
                    aria-hidden
                  />
                  Optional details
                </button>

                {showAdvanced ? (
                  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="support-subject">Subject</Label>
                      <Input
                        id="support-subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        maxLength={180}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="support-category">Category</Label>
                        <select
                          id="support-category"
                          className={selectClass}
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          {SUPPORT_TICKET_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="support-priority">Priority</Label>
                        <select
                          id="support-priority"
                          className={selectClass}
                          value={priority}
                          onChange={(e) => setPriority(e.target.value)}
                        >
                          {SUPPORT_TICKET_PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="support-name">Your name</Label>
                        <Input
                          id="support-name"
                          value={requesterName}
                          onChange={(e) => setRequesterName(e.target.value)}
                          maxLength={120}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="support-email">Email</Label>
                        <Input
                          id="support-email"
                          type="email"
                          value={requesterEmail}
                          onChange={(e) => setRequesterEmail(e.target.value)}
                          maxLength={180}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>

              <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !description.trim()}>
                  {pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    "Send ticket"
                  )}
                </Button>
              </footer>
            </form>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SupportTicketButton({
  contextOverride,
  className,
  variant = "floating",
  label = "Need help?",
}: {
  contextOverride?: SupportTicketContextOverride;
  className?: string;
  variant?: "floating" | "inline";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant === "floating" ? "default" : "outline"}
        size={variant === "floating" ? "default" : "sm"}
        className={cn(
          variant === "floating" &&
            "fixed bottom-6 right-6 z-40 h-10 gap-2 rounded-full px-4 shadow-lg",
          className
        )}
        onClick={() => setOpen(true)}
      >
        <LifeBuoy className="size-4" aria-hidden />
        {label}
      </Button>
      <SupportTicketModal open={open} onOpenChange={setOpen} contextOverride={contextOverride} />
    </>
  );
}
