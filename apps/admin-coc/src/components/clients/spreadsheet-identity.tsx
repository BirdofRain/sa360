"use client";

import { useState } from "react";

export function SpreadsheetIdentity({
  title,
  spreadsheetId,
  url,
}: {
  title: string;
  spreadsheetId: string;
  url?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const href = url && url.startsWith("https://docs.google.com/spreadsheets/d/") ? url : null;
  return (
    <div className="min-w-0 max-w-full" data-testid="spreadsheet-identity">
      {href ? (
        <a className="break-words text-sm text-sky-700 underline" href={href}>
          {title}
        </a>
      ) : (
        <p className="break-words text-sm font-medium text-slate-900">{title}</p>
      )}
      <details className="mt-1 min-w-0">
        <summary className="cursor-pointer text-xs text-slate-600">Spreadsheet ID</summary>
        <div className="mt-1 flex min-w-0 flex-wrap items-start gap-2">
          <code className="min-w-0 flex-1 break-all text-xs text-slate-800">{spreadsheetId}</code>
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            onClick={() => {
              const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
              if (!clipboard?.writeText) return;
              void clipboard.writeText(spreadsheetId).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy ID"}
          </button>
        </div>
      </details>
    </div>
  );
}
