import { describe, expect, it } from "vitest";
import { guardUrl, isPrivateAddress } from "../../src/retrieval/urlGuard.js";

const strict = { allowPrivate: false };
const relaxed = { allowPrivate: true };

const resolvesTo = (address: string) => async () => [address];

describe("isPrivateAddress", () => {
  it("recognises the private and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("isPrivateAddress with IPv4 hidden inside IPv6", () => {
  it("rejects every smuggled private form", () => {
    for (const address of [
      "::7f00:1", // IPv4-compatible 127.0.0.1, as URL parsing normalises [::127.0.0.1]
      "::127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe", // NAT64 of the metadata address
      "2002:7f00:1::", // 6to4 of 127.0.0.1
      "fec0::1", // site-local
      "ff02::1",
      "0:0:0:0:0:0:0:1",
      "198.18.0.1",
      "not:an:address::x",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("still lets public IPv6 and public NAT64 through", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("64:ff9b::808:808")).toBe(false);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("rejects the bracketed forms in a URL", async () => {
    for (const url of ["http://[::127.0.0.1]/", "http://[64:ff9b::a9fe:a9fe]/latest/meta-data/"]) {
      expect((await guardUrl(url, strict)).ok, url).toBe(false);
    }
  });
});

describe("guardUrl", () => {
  it("allows a public host", async () => {
    const result = await guardUrl("https://acme.com/careers", {
      ...strict,
      lookup: resolvesTo("93.184.216.34"),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a hostname that resolves into a private range", async () => {
    const result = await guardUrl("https://internal.acme.com", {
      ...strict,
      lookup: resolvesTo("10.0.0.5"),
    });
    expect(result).toMatchObject({ ok: false, reason: "resolves to a private address" });
  });

  it("rejects the cloud metadata address", async () => {
    const result = await guardUrl("http://169.254.169.254/latest/meta-data/", strict);
    expect(result.ok).toBe(false);
  });

  it("rejects localhost by name and by address", async () => {
    expect((await guardUrl("http://localhost:8099/acme/", strict)).ok).toBe(false);
    expect((await guardUrl("http://127.0.0.1:8099/acme/", strict)).ok).toBe(false);
  });

  it("rejects a non-http scheme", async () => {
    for (const url of ["file:///etc/passwd", "ftp://acme.com", "gopher://acme.com"]) {
      const result = await guardUrl(url, strict);
      expect(result.ok, url).toBe(false);
    }
  });

  it("rejects credentials embedded in the URL", async () => {
    const result = await guardUrl("https://user:pass@acme.com", {
      ...strict,
      lookup: resolvesTo("93.184.216.34"),
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a hostname that does not resolve", async () => {
    const result = await guardUrl("https://nope.invalid", {
      ...strict,
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "hostname does not resolve" });
  });

  it("rejects text that is not a URL", async () => {
    expect((await guardUrl("not a url", strict)).ok).toBe(false);
  });

  it("allows localhost when private addresses are explicitly permitted", async () => {
    // This is how the batch CLI reaches the fixture site.
    const result = await guardUrl("http://localhost:8099/acme/", relaxed);
    expect(result.ok).toBe(true);
  });
});
