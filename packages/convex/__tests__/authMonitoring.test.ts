import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  hashMonitoringSubject,
  isExpiredJwt,
  logPublicApiAuthOutcome,
  logResolverDenial,
} from "../authMonitoring";

const captureConsole = (
  method: "warn" | "log",
  impl: (...args: unknown[]) => void = () => undefined
) => {
  const original = console[method];
  const spy = mock(impl);
  console[method] = spy;
  return {
    spy,
    restore: () => {
      console[method] = original;
    },
  };
};

describe("resolver denial log", () => {
  test("hashes the subject server-side before logging", async () => {
    const expected = `s_${createHash("sha256").update("user_01SECRET").digest("hex").slice(0, 16)}`;
    expect(await hashMonitoringSubject("user_01SECRET")).toBe(expected);

    const warn = captureConsole("warn");
    try {
      await logResolverDenial({
        reason: "missing_mapping",
        verification: { kind: "session", emailVerified: true },
        workosUserId: "user_01SECRET",
      });
      expect(warn.spy).toHaveBeenCalledTimes(1);
      expect(warn.spy.mock.calls[0]).toEqual([
        "identity_resolver_denial",
        {
          provider: "workos",
          reason: "missing_mapping",
          verification: "session",
          emailVerified: true,
          subject: expected,
        },
      ]);
      expect(JSON.stringify(warn.spy.mock.calls)).not.toContain(
        "user_01SECRET"
      );
    } finally {
      warn.restore();
    }
  });

  test("a failing logger never throws into resolution", async () => {
    const warn = captureConsole("warn", () => {
      throw new Error("log sink down");
    });
    try {
      await expect(
        logResolverDenial({
          reason: "verify_email",
          verification: { kind: "connect" },
          workosUserId: "user_1",
        })
      ).resolves.toBeUndefined();
    } finally {
      warn.restore();
    }
  });
});

describe("public API auth outcome log", () => {
  test("a failing logger never throws into the API boundary", () => {
    const log = captureConsole("log", () => {
      throw new Error("log sink down");
    });
    try {
      expect(() =>
        logPublicApiAuthOutcome({
          check: "request",
          credential: "api_key",
          reason: "ok",
          status: 200,
          surface: "rest",
        })
      ).not.toThrow();
    } finally {
      log.restore();
    }
  });

  test("labels an expired rejected JWT without trusting anything else", () => {
    const token = (exp: number) =>
      `h.${btoa(JSON.stringify({ exp })).replace(/[=]+$/u, "")}.sig`;
    const now = Date.parse("2026-10-07T10:00:00Z");
    expect(isExpiredJwt(token(now / 1000 - 1), now)).toBe(true);
    expect(isExpiredJwt(token(now / 1000 + 60), now)).toBe(false);
    expect(isExpiredJwt("not.a-jwt.at-all", now)).toBe(false);
  });
});
