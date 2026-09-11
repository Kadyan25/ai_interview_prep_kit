import dns from "node:dns/promises";
import net from "node:net";

/**
 * The crawler follows links from a URL the user typed, so it is a server-side
 * request forgery risk by construction. Every URL is checked here before a
 * socket is opened, and again after every redirect.
 */

export type GuardOk = { ok: true; url: URL; addresses: string[] };
export type GuardFail = { ok: false; reason: string };
export type GuardResult = GuardOk | GuardFail;

export type GuardOptions = {
  /** Dev and the batch CLI need localhost for the fixture site; production does not. */
  allowPrivate: boolean;
  lookup?: (hostname: string) => Promise<string[]>;
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

function ipv4ToParts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts;
}

/** Loopback, link-local, private, carrier-grade NAT, multicast and reserved space. */
export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = ipv4ToParts(address);
    if (!parts) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (version === 6) {
    const normalised = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalised === "::" || normalised === "::1") return true;
    if (normalised.startsWith("fe80") || normalised.startsWith("fc") || normalised.startsWith("fd")) {
      return true;
    }
    if (normalised.startsWith("::ffff:")) {
      const mapped = normalised.slice("::ffff:".length);
      return net.isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
    }
    return false;
  }

  return true; // not an IP literal at all
}

export async function guardUrl(raw: string, options: GuardOptions): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme ${url.protocol}` };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not fetched" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (options.allowPrivate) {
    // Still resolve nothing and allow everything: this mode exists so the batch
    // CLI can hit the local fixture site.
    return { ok: true, url, addresses: [] };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, reason: "points at a local address" };
  }

  if (net.isIP(hostname) !== 0) {
    return isPrivateAddress(hostname)
      ? { ok: false, reason: "points at a private address" }
      : { ok: true, url, addresses: [hostname] };
  }

  let addresses: string[];
  try {
    const lookup = options.lookup ?? defaultLookup;
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, reason: "hostname does not resolve" };
  }

  if (addresses.length === 0) return { ok: false, reason: "hostname does not resolve" };
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "resolves to a private address" };
  }

  return { ok: true, url, addresses };
}
