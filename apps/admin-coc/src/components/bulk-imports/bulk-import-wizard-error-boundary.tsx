"use client";

import Link from "next/link";
import React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
  importId: string;
  viewStep?: string;
  progressStep?: string;
  batchStatus?: string;
  schemaValidation?: string;
};

type State = {
  error: Error | null;
  componentStack: string | null;
};

export class BulkImportWizardErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error("Bulk import wizard error", error, info);
  }

  private diagnosticText(): string {
    const deployedCommit =
      process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT?.trim() || "unknown";
    const lines = [
      `importId: ${this.props.importId}`,
      `viewStep: ${this.props.viewStep ?? "unknown"}`,
      `progressStep: ${this.props.progressStep ?? "unknown"}`,
      `batchStatus: ${this.props.batchStatus ?? "unknown"}`,
      `deployedCommit: ${deployedCommit}`,
      `schemaValidation: ${this.props.schemaValidation ?? "unknown"}`,
      `error: ${this.state.error?.message ?? "unknown"}`,
    ];
    if (this.state.componentStack) {
      lines.push(`componentStack: ${this.state.componentStack.slice(0, 1200)}`);
    }
    return lines.join("\n");
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">
            The import action completed, but this view could not be rendered.
          </p>
          <p className="text-sm text-muted-foreground">
            {this.state.error.message || "An unexpected rendering error occurred."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Reload import
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(this.diagnosticText())}
            >
              Copy diagnostic
            </Button>
            <Link
              href="/source-intake/imports"
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
            >
              Return to imports
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
