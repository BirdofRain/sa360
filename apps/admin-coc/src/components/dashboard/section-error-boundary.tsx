"use client";

import { Component, type ReactNode } from "react";

import { WarningBanner } from "@/components/dashboard/warning-banner";

type Props = {
  /** Section name surfaced in the inline fallback. */
  title?: string;
  children: ReactNode;
};

type State = { hasError: boolean; message: string | null };

/**
 * Isolates a drawer section so a render-time throw (e.g. an unexpected delivery plan
 * or duplicate-risk shape) shows an inline warning instead of bubbling to the route
 * segment error boundary and crashing the whole Routing Dry Run page.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unexpected render error.",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <WarningBanner tone="warn" title={`${this.props.title ?? "Section"} could not be displayed`}>
          This section failed to render and was isolated so the rest of the page stays usable.
          {this.state.message ? (
            <span className="mt-1 block font-mono text-xs text-muted-foreground">
              {this.state.message}
            </span>
          ) : null}
        </WarningBanner>
      );
    }
    return this.props.children;
  }
}
