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
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (version === 6) {
    const hextets = expandIpv6(address.replace(/^\[|\]$/g, ""));
    return hextets ? isPrivateIpv6(hextets) : true;
  }

  return true; // not an IP literal at all
}

/** "::ffff:127.0.0.1" → eight 16-bit groups, or null if it is not valid IPv6. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  // A trailing dotted IPv4 part stands for the last two groups.
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = ipv4ToParts(dotted[1]!);
    if (!parts) return null;
    const high = ((parts[0]! << 8) | parts[1]!).toString(16);
    const low = ((parts[2]! << 8) | parts[3]!).toString(16);
    text = `${text.slice(0, -dotted[1]!.length)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return values.some(Number.isNaN) ? null : values;
}

function embeddedIpv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Loopback, unspecified, unique-local, link-local and site-local ranges, plus
 * every form that smuggles an IPv4 address inside IPv6 — mapped, compatible,
 * NAT64 and 6to4 — checked against the IPv4 rules, so [64:ff9b::a9fe:a9fe]
 * (the cloud metadata address) is caught.
 */
function isPrivateIpv6(g: number[]): boolean {
  const [a, b, c, d, e, f, gg, h] = g as [number, number, number, number, number, number, number, number];
  const leadingZeros = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  if (leadingZeros && f === 0) {
    // "::" and "::1" and the deprecated IPv4-compatible form ::a.b.c.d
    return gg === 0 ? true : isPrivateAddress(embeddedIpv4(gg, h));
  }
  if (leadingZeros && f === 0xffff) return isPrivateAddress(embeddedIpv4(gg, h));
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isPrivateAddress(embeddedIpv4(gg, h));
  }
  if (a === 0x2002) return isPrivateAddress(embeddedIpv4(b, c));
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if (a >= 0xff00) return true; // multicast
  return false;
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
