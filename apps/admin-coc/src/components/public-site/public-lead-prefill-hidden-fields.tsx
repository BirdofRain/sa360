"use client";

import { useEffect, useState } from "react";

import {
  emptyPublicLeadPrefill,
  publicLeadPrefillHasValues,
  readPublicLeadPrefill,
  serializeParsedPrefillQuery,
  writePublicLeadPrefillFromParsed,
  type ParsedPublicLeadPrefill,
} from "@/lib/public-site/lead-request-handoff";

export function useResolvedPublicLeadPrefill(
  initial?: ParsedPublicLeadPrefill
): ParsedPublicLeadPrefill {
  const query = initial ? serializeParsedPrefillQuery(initial) : "";
  const [prefill, setPrefill] = useState(() => initial ?? emptyPublicLeadPrefill());

  useEffect(() => {
    if (initial && publicLeadPrefillHasValues(initial)) {
      writePublicLeadPrefillFromParsed(initial);
      setPrefill(initial);
      return;
    }
    const stored = readPublicLeadPrefill();
    if (publicLeadPrefillHasValues(stored)) setPrefill(stored);
  }, [initial, query]);

  return prefill;
}

export function PublicLeadPrefillHiddenFields({
  prefill,
}: {
  prefill: ParsedPublicLeadPrefill;
}) {
  const params = new URLSearchParams(serializeParsedPrefillQuery(prefill));
  return (
    <>
      {[...params.entries()].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
