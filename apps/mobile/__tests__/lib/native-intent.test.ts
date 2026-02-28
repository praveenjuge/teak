import { describe, expect, test } from "bun:test";
import { resolveIncomingSharePath } from "../../app/+native-intent";

describe("+native-intent", () => {
  test("maps teak://expo-sharing to incoming-share route", () => {
    expect(resolveIncomingSharePath("teak://expo-sharing")).toBe(
      "/incoming-share"
    );
  });

  test("maps /expo-sharing path to incoming-share route", () => {
    expect(resolveIncomingSharePath("/expo-sharing")).toBe("/incoming-share");
  });

  test("does not map unrelated system paths", () => {
    expect(resolveIncomingSharePath("teak://cards/123")).toBeNull();
  });
});
