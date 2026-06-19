"use client";

import React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class BulkImportWizardErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Bulk import wizard error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium text-destructive">Bulk import wizard error</p>
          <p className="text-sm text-muted-foreground">
            {this.state.error.message || "An unexpected error occurred in the import wizard."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
