import { describe, expect, test } from "bun:test";
import {
  convexRunError,
  describeLease,
  parseRunOutput,
} from "./convex-push-lease.ts";

describe("parseRunOutput", () => {
  test("reads the result after any log lines", () => {
    expect(
      parseRunOutput(
        '[CONVEX M(devPushLease:acquire)] log\n{\n  "granted": true\n}\n'
      )
    ).toEqual({ granted: true });
    expect(parseRunOutput("true\n")).toBe(true);
    expect(() => parseRunOutput("nothing here")).toThrow();
  });
});

describe("convexRunError", () => {
  test("keeps the thrown message and drops stack frames", () => {
    expect(
      convexRunError(
        '✖ Failed to run function "devSeed:seed":\nError: [Request ID: 1] Server Error\nUncaught Error: The dev account has no Teak owner yet.\n    at handler (../devSeed.ts:250:8)\n'
      )
    ).toBe("The dev account has no Teak owner yet");
    expect(convexRunError("network down\n    at fetch (x.ts:1:1)")).toBe(
      "network down"
    );
  });
});

describe("describeLease", () => {
  const self = { id: "mac:/teak/wt", label: "feature (~/teak/wt on mac)" };

  test("says who pushes and which code is live", () => {
    expect(
      describeLease(
        {
          holder: {
            id: "mac:/teak",
            label: "main (~/teak on mac)",
            expiresAt: 1,
          },
          lastPush: { label: "main (~/teak on mac)", commit: "abc1234", at: 1 },
        },
        self
      )
    ).toBe(
      "main (~/teak on mac) pushes the backend; live code: main (~/teak on mac) at abc1234"
    );
    expect(
      describeLease({ holder: { ...self, expiresAt: 1 }, lastPush: null }, self)
    ).toBe("this checkout pushes the backend");
    expect(describeLease({ holder: null, lastPush: null })).toBe(
      "nobody holds the push lease"
    );
  });
});
