import { describe, expect, mock, test } from "bun:test";
import { hashMonitoringSubject, logResolverDenial } from "../authMonitoring";

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
    const expected = "s_f4db5fa1555c0c60";
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
      ).resolves.toBe(false);
    } finally {
      warn.restore();
    }
  });
});
