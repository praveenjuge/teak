import { describe, expect, test } from "bun:test";
import { isLocalSelection } from "./setup-mode.ts";

describe("isLocalSelection", () => {
  test("no deployment and local backends are local", () => {
    expect(isLocalSelection(undefined)).toBe(true);
    expect(isLocalSelection("anonymous:anonymous-agent")).toBe(true);
    expect(isLocalSelection("local:teak")).toBe(true);
    expect(isLocalSelection("dev:happy-otter-123")).toBe(false);
  });
});
