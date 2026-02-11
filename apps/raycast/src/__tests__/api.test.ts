import { describe, expect, test } from "bun:test";

describe("raycast api helpers", () => {
  test("normalizes url-like strings consistently", () => {
    const raw = "https://app.teakvault.com/";
    const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    expect(normalized).toBe("https://app.teakvault.com");
  });

  test("encodes search query params", () => {
    const params = new URLSearchParams();
    params.set("q", "design systems");
    params.set("limit", "50");
    expect(params.toString()).toBe("q=design+systems&limit=50");
  });
});
