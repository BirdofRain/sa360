import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * SSRF policy for a client-supplied external webhook URL.
 * This module does not open a socket. Callers pass a resolver.
 * The later sender must refuse redirects and pin the accepted addresses.
 */

export const EXTERNAL_WEBHOOK_HTTP_POLICY = {
  contractVersion: "sa360.external_webhook.http.v1",
  methods: ["POST"],
  allowedProtocols: ["https:"],
  userinfo: "refuse",
  fragments: "refuse",
  redirects: "refuse",
  maxRedirects: 0,
  resolveBeforeConnect: true,
  pinResolvedAddresses: true,
  reresolveOnRetry: true,
  timeoutMs: 10_000,
  followRedirects: false,
} as const;

export type ExternalWebhookResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type ExternalWebhookResolver = (
  hostname: string
) => Promise<readonly ExternalWebhookResolvedAddress[]>;

type LookupAddress = { address: string; family: number };

export function createLookupResolver(
  lookup: (hostname: string) => Promise<readonly LookupAddress[]>
): ExternalWebhookResolver {
  return async (hostname) => {
    const answers = await lookup(hostname);
    return answers.map((answer) => ({
      address: answer.address,
      family: answer.family === 6 ? 6 : 4,
    }));
  };
}

/** Node resolver for a later sender. This foundation's tests do not call it. */
export const nodeExternalWebhookResolver: ExternalWebhookResolver = createLookupResolver((hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true })
);

export type ExternalWebhookUrlRejection =
  | "invalid_url"
  | "not_https"
  | "userinfo"
  | "fragment"
  | "internal_hostname"
  | "obfuscated_address"
  | "private_address"
  | "dns_empty"
  | "dns_private"
  | "dns_failed";

export type ExternalWebhookUrlResult =
  | {
      ok: true;
      canonicalUrl: string;
      hostname: string;
      addresses: readonly string[];
    }
  | { ok: false; code: ExternalWebhookUrlRejection };

const EXACT_INTERNAL_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".svc.cluster.local"];

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
blocked.addAddress("255.255.255.255", "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const IPV4_MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/**
 * IPv4-mapped IPv6 is unwrapped before the block list. Node treats a
 * `::ffff:0:0/96` rule as covering every IPv4 address, so that prefix is not added.
 */
export function externalWebhookAddressIsBlocked(address: string): boolean {
  const normalized = unwrapMappedIpv4(address.trim().toLowerCase());
  const family = isIP(normalized);
  if (family === 0) return true;
  return blocked.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function unwrapMappedIpv4(address: string): string {
  const dotted = IPV4_MAPPED_DOTTED.exec(address);
  if (dotted) return dotted[1];
  const hex = IPV4_MAPPED_HEX.exec(address);
  if (!hex) return address;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

export function externalWebhookRedirectDisposition(status: number): "not_a_redirect" | "refused" {
  if (status >= 300 && status <= 399) return "refused";
  return "not_a_redirect";
}

export async function validateExternalWebhookUrl(
  raw: string,
  resolve: ExternalWebhookResolver
): Promise<ExternalWebhookUrlResult> {
  const synchronous = inspectExternalWebhookUrl(raw);
  if (!synchronous.ok) return synchronous;
  if (synchronous.literalAddresses) {
    return {
      ok: true,
      canonicalUrl: synchronous.canonicalUrl,
      hostname: synchronous.hostname,
      addresses: synchronous.literalAddresses,
    };
  }
  let answers: readonly ExternalWebhookResolvedAddress[];
  try {
    answers = await resolve(synchronous.hostname);
  } catch {
    return { ok: false, code: "dns_failed" };
  }
  if (answers.length === 0) return { ok: false, code: "dns_empty" };
  const addresses = answers.map((answer) => answer.address);
  if (addresses.some((address) => externalWebhookAddressIsBlocked(address))) {
    return { ok: false, code: "dns_private" };
  }
  return {
    ok: true,
    canonicalUrl: synchronous.canonicalUrl,
    hostname: synchronous.hostname,
    addresses,
  };
}

type SynchronousUrl =
  | { ok: false; code: ExternalWebhookUrlRejection }
  | {
      ok: true;
      canonicalUrl: string;
      hostname: string;
      literalAddresses: readonly string[] | null;
    };

export function inspectExternalWebhookUrl(raw: string): SynchronousUrl {
  if (typeof raw !== "string" || raw.trim() === "" || /[\s\u0000]/.test(raw)) {
    return { ok: false, code: "invalid_url" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, code: "userinfo" };
  if (url.hash !== "") return { ok: false, code: "fragment" };
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname.endsWith(".")) return { ok: false, code: "invalid_url" };
  if (isInternalHostname(hostname)) return { ok: false, code: "internal_hostname" };
  if (isObfuscatedAddress(hostname)) return { ok: false, code: "obfuscated_address" };
  const family = isIP(hostname);
  if (family !== 0) {
    if (externalWebhookAddressIsBlocked(hostname)) return { ok: false, code: "private_address" };
    return {
      ok: true,
      canonicalUrl: url.href,
      hostname,
      literalAddresses: [hostname],
    };
  }
  return { ok: true, canonicalUrl: url.href, hostname, literalAddresses: null };
}

function isInternalHostname(hostname: string): boolean {
  if (EXACT_INTERNAL_HOSTS.has(hostname)) return true;
  return INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isObfuscatedAddress(hostname: string): boolean {
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) return true;
  if (!hostname.includes(".")) return false;
  const labels = hostname.split(".");
  if (labels.length < 4 && labels.every((label) => /^\d+$/.test(label))) return true;
  if (labels.length === 4 && labels.some((label) => /^0\d/.test(label))) return true;
  return false;
}
