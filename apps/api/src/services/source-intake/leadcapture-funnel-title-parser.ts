/**
 * Deterministic LeadCapture NextGen funnel-title parser for human association hints.
 *
 * Canonical convention:
 *   Life Insurance For <NICHE> - <CLIENT NAME> - V<NUMBER>
 * Also accepts the same title without a version suffix when unambiguous.
 *
 * Display titles are never machine identity. Niche recognition reuses the
 * existing LeadCapture name taxonomy and never silently defaults unknown text
 * to Veteran.
 */

import {
  parseLeadCaptureFunnelNameNiche,
  type LeadCaptureInventoryNicheKey,
} from "./leadcapture-funnel-name-niche.js";
import type { LeadCaptureRecognizedNicheKey } from "./leadcapture-niche-resolver.js";

export type ParsedLeadCaptureFunnelTitle = {
  nicheKey: LeadCaptureRecognizedNicheKey | undefined;
  inventoryNicheKey: LeadCaptureInventoryNicheKey | undefined;
  clientNameHint: string | undefined;
  version: number | undefined;
};

const DASH_VARIANTS = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const VERSION_SEGMENT = /^v(\d+)$/i;
const TRAILING_VERSION = /^(.*?)(?:\s+[-–—]?\s*v(\d+))$/i;

export function normalizeComparableClientName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeLeadCaptureFunnelTitle(value: string): string {
  return value
    .replace(DASH_VARIANTS, "-")
    .replace(/-+/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVersionSegment(segment: string): { name: string; version: number | undefined } {
  const trimmed = segment.trim();
  const exact = trimmed.match(VERSION_SEGMENT);
  if (exact) return { name: "", version: Number(exact[1]) };
  const trailing = trimmed.match(TRAILING_VERSION);
  if (trailing && trailing[1]?.trim()) {
    return { name: trailing[1].trim(), version: Number(trailing[2]) };
  }
  return { name: trimmed, version: undefined };
}

export function parseLeadCaptureFunnelTitle(label: unknown): ParsedLeadCaptureFunnelTitle {
  const empty: ParsedLeadCaptureFunnelTitle = {
    nicheKey: undefined,
    inventoryNicheKey: undefined,
    clientNameHint: undefined,
    version: undefined,
  };
  if (typeof label !== "string") return empty;
  const normalized = normalizeLeadCaptureFunnelTitle(label);
  if (!normalized) return empty;

  const fromName = parseLeadCaptureFunnelNameNiche(normalized);
  const segments = normalized.split(" - ").map((part) => part.trim()).filter(Boolean);

  let version: number | undefined;
  const nameParts: string[] = [];
  if (segments.length >= 2) {
    const last = parseVersionSegment(segments[segments.length - 1]!);
    version = last.version;
    const clientSegments = last.name
      ? [...segments.slice(1, -1), last.name]
      : segments.slice(1, -1);
    const hint = clientSegments.join(" - ").trim();
    if (hint) nameParts.push(hint);
  }

  return {
    nicheKey: fromName?.recognizedNicheKey,
    inventoryNicheKey: fromName?.inventoryNicheKey,
    clientNameHint: nameParts[0] || undefined,
    version,
  };
}
