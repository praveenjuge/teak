import { describe, expect, test } from "bun:test";
import { getDisplayHostname } from "../displayHost";

describe("getDisplayHostname", () => {
  test("drops www. and keeps the rest of the host", () => {
    expect(getDisplayHostname("https://www.theverge.com/2024/a")).toBe(
      "theverge.com"
    );
    expect(getDisplayHostname("https://docs.convex.dev/x?y=1")).toBe(
      "docs.convex.dev"
    );
  });

  test("names no site for unsafe or missing links", () => {
    expect(getDisplayHostname("javascript:alert(1)")).toBeUndefined();
    expect(getDisplayHostname(undefined)).toBeUndefined();
  });
});
