import { describe, expect, test } from "bun:test";
import { openApiSpec } from "@teak/convex/publicApi/openApi/spec";
import { legacyReferenceRedirects, operationSlug } from "./referenceRedirects";

const redirects = legacyReferenceRedirects(openApiSpec);
const target = (from: string) =>
  redirects.find((redirect) => redirect.from === from)?.to;

describe("legacy API reference addresses", () => {
  test("old slugs Search Console reported reach today's pages", () => {
    expect(target("/reference/operations/deletecard")).toBe(
      "/reference/operations/delete-card"
    );
    expect(target("/reference/operations/getapidiscovery")).toBe(
      "/reference/operations/get-api-discovery"
    );
    expect(target("/reference/operations/patch-v1-cards-cardid")).toBe(
      "/reference/operations/update-card"
    );
    expect(target("/reference/operations/get-v1")).toBe(
      "/reference/operations/get-api-discovery"
    );
    expect(target("/reference/operations/get-healthz")).toBe(
      "/reference/operations/get-health"
    );
    expect(target("/reference/operations/get-v1-cards-search")).toBe(
      "/reference/operations/list-cards"
    );
  });

  test("slugs follow Blume's operation page names", () => {
    expect(operationSlug("disconnectOAuthConsent")).toBe(
      "disconnect-o-auth-consent"
    );
  });

  test("no redirect points at itself or repeats", () => {
    const froms = redirects.map((redirect) => redirect.from);
    expect(new Set(froms).size).toBe(froms.length);
    for (const redirect of redirects) {
      expect(redirect.to).not.toBe(redirect.from);
    }
  });
});
