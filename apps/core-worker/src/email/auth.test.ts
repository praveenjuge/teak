import { describe, expect, test } from "bun:test";
import PostalMime from "postal-mime";
import { fixture } from "../test/emailSupport";
import {
  parseAuthResults,
  type SenderRejection,
  stripComments,
  verifySender,
} from "./auth";

const verdictFor = async (name: string) =>
  verifySender(await PostalMime.parse(fixture(name)));

describe("verifySender", () => {
  test("a sender whose domain passed DMARC at Cloudflare is the From address", async () => {
    expect(await verdictFor("plain.eml")).toEqual({
      from: "ada.example@gmail.com",
      ok: true,
    });
  });

  test.each<[string, SenderRejection]>([
    ["dmarc-fail.eml", "dmarc_fail"],
    ["from-mismatch.eml", "dmarc_domain_mismatch"],
    ["no-cloudflare.eml", "no_cloudflare_results"],
    ["two-from.eml", "multiple_from"],
  ])("%s is refused (%s)", async (name, reason) => {
    expect(await verdictFor(name)).toEqual({ ok: false, reason });
  });

  test.each<[string, string, SenderRejection]>([
    ["no DMARC result at all", "", "dmarc_fail"],
    [
      "a DMARC pass that names no From domain",
      "\r\n dmarc=pass policy.dmarc=none;",
      "dmarc_domain_mismatch",
    ],
  ])("Cloudflare's header with %s is refused", async (_name, dmarc, reason) => {
    const eml = fixture("plain.eml").replace(
      "\r\n dmarc=pass header.from=gmail.com policy.dmarc=none;",
      dmarc
    );
    expect(eml).not.toContain("header.from=gmail.com");
    expect(verifySender(await PostalMime.parse(eml))).toEqual({
      ok: false,
      reason,
    });
  });

  test("a forged mx.cloudflare.net pass below Cloudflare's own fail still fails", async () => {
    expect(await verdictFor("forged-below.eml")).toEqual({
      ok: false,
      reason: "dmarc_fail",
    });
  });

  test("only the topmost authentication header counts, and it must be Cloudflare's", async () => {
    // The real Cloudflare pass sits below another server's header: refused,
    // because a header above Cloudflare's can only have been added after it.
    expect(await verdictFor("foreign-topmost.eml")).toEqual({
      ok: false,
      reason: "no_cloudflare_results",
    });
  });

  test("a From header without an address is refused", () => {
    expect(
      verifySender({
        headers: [
          { key: "from", value: "Undisclosed recipients:;" },
          {
            key: "arc-authentication-results",
            value: "i=1; mx.cloudflare.net; dmarc=pass header.from=gmail.com",
          },
        ],
      })
    ).toEqual({ ok: false, reason: "no_from" });
  });

  test("two From headers are refused", () => {
    expect(
      verifySender({
        headers: [
          { key: "from", value: "ada.example@gmail.com" },
          { key: "from", value: "grace.example@gmail.com" },
        ],
      })
    ).toEqual({ ok: false, reason: "multiple_from" });
  });

  test("case doesn't matter in the address or the verdict's domain", () => {
    expect(
      verifySender({
        headers: [
          {
            key: "authentication-results",
            value: "MX.Cloudflare.NET; DMARC=Pass header.from=Example.COM",
          },
          { key: "from", value: "Ada <Ada@Example.com>" },
        ],
      })
    ).toEqual({ from: "ada@example.com", ok: true });
  });

  test("a second DMARC result that fails refuses the message", () => {
    expect(
      verifySender({
        headers: [
          {
            key: "authentication-results",
            value:
              "mx.cloudflare.net; dmarc=pass header.from=gmail.com; dmarc=fail header.from=gmail.com",
          },
          { key: "from", value: "ada.example@gmail.com" },
        ],
      })
    ).toEqual({ ok: false, reason: "dmarc_fail" });
  });
});

describe("parseAuthResults", () => {
  test("reads Cloudflare's ARC results, comments and all", () => {
    const parsed = parseAuthResults(
      "i=1; mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass header.from=gmail.com policy.dmarc=none; spf=pass (mx.cloudflare.net: domain of a@gmail.com designates 1.2.3.4 as permitted sender; really) smtp.mailfrom=a@gmail.com",
      true
    );
    expect(parsed.authservId).toBe("mx.cloudflare.net");
    expect(
      parsed.results.map((result) => [
        result.method,
        result.result,
        Object.fromEntries(result.properties),
      ])
    ).toEqual([
      ["dkim", "pass", { "header.d": "gmail.com" }],
      ["dmarc", "pass", { "header.from": "gmail.com", "policy.dmarc": "none" }],
      ["spf", "pass", { "smtp.mailfrom": "a@gmail.com" }],
    ]);
  });

  test("an authserv-id with a version number", () => {
    expect(
      parseAuthResults("mx.cloudflare.net 1; none", false).authservId
    ).toBe("mx.cloudflare.net");
  });

  test("nested comments and quoted parentheses", () => {
    expect(stripComments('a (b (c) d) "e (f)" g')).toBe('a  "e (f)" g');
  });
});
