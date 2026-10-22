import { describe, expect, test } from "bun:test";
import {
  clampPublicApiLimit,
  PUBLIC_API_DEFAULT_LIMIT,
  PUBLIC_API_MAX_LIMIT,
} from "../../shared/publicApiLimits";

describe("clampPublicApiLimit", () => {
  test.each<[number | undefined, number]>([
    [undefined, PUBLIC_API_DEFAULT_LIMIT],
    [Number.NaN, PUBLIC_API_DEFAULT_LIMIT],
    [Number.POSITIVE_INFINITY, PUBLIC_API_DEFAULT_LIMIT],
    [-5, 1],
    [0, 1],
    [1, 1],
    [25, 25],
    [PUBLIC_API_MAX_LIMIT, PUBLIC_API_MAX_LIMIT],
    [PUBLIC_API_MAX_LIMIT + 1, PUBLIC_API_MAX_LIMIT],
    [10_000, PUBLIC_API_MAX_LIMIT],
  ])("%p becomes %p", (limit, expected) => {
    expect(clampPublicApiLimit(limit)).toBe(expected);
  });
});
