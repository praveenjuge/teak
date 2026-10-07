import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import {
  classifyBetterAuthSignIn,
  hashMonitoringSubject,
  isExpiredJwt,
  logPublicApiAuthOutcome,
  logResolverDenial,
} from "../authMonitoring";

type SignInInput = Partial<Parameters<typeof classifyBetterAuthSignIn>[0]> & {
  path: string;
};

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

const redirect = (location: string) =>
  new APIError("FOUND", undefined, new Headers({ location }));
const existingUserSession = {
  session: { createdAt: new Date("2026-10-07T10:00:00Z") },
  user: { createdAt: new Date("2025-01-01T00:00:00Z"), email: "a@b.co" },
};
const newUserSession = {
  session: { createdAt: new Date("2026-10-07T10:00:01Z") },
  user: { createdAt: new Date("2026-10-07T10:00:00Z") },
};

describe("Better Auth sign-in classification", () => {
  test.each([
    [
      "email success",
      { path: "/sign-in/email", newSession: existingUserSession },
      { method: "email", outcome: "success", reason: "ok" },
    ],
    [
      "email wrong password",
      {
        path: "/sign-in/email",
        returned: new APIError("UNAUTHORIZED", {
          code: "INVALID_EMAIL_OR_PASSWORD",
        }),
      },
      {
        method: "email",
        outcome: "failure",
        reason: "invalid_email_or_password",
      },
    ],
    [
      "email unverified",
      {
        path: "/sign-in/email",
        returned: new APIError("FORBIDDEN", { code: "EMAIL_NOT_VERIFIED" }),
      },
      { method: "email", outcome: "failure", reason: "email_not_verified" },
    ],
    [
      "social callback for an existing user",
      {
        path: "/callback/:id",
        providerId: "google",
        newSession: existingUserSession,
      },
      {
        method: "social",
        outcome: "success",
        provider: "google",
        reason: "ok",
      },
    ],
    [
      "social callback error redirect",
      {
        path: "/callback/:id",
        providerId: "apple",
        returned: redirect(
          "https://app.teakvault.com/login?error=invalid_code"
        ),
      },
      {
        method: "social",
        outcome: "failure",
        provider: "apple",
        reason: "invalid_code",
      },
    ],
    [
      "native id-token sign-in rejected",
      {
        path: "/sign-in/social",
        providerId: "apple",
        returned: new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN" }),
      },
      {
        method: "social",
        outcome: "failure",
        provider: "apple",
        reason: "invalid_token",
      },
    ],
  ])(
    "counts %s as one attempt",
    (_name: string, input: SignInInput, expected: unknown) => {
      expect(
        classifyBetterAuthSignIn({
          newSession: null,
          returned: undefined,
          ...input,
        })
      ).toEqual(expected);
    }
  );

  test.each([
    [
      "session refresh",
      { path: "/get-session", newSession: existingUserSession },
    ],
    ["token refresh", { path: "/token" }],
    ["email sign-up", { path: "/sign-up/email", newSession: newUserSession }],
    ["sign-out", { path: "/sign-out" }],
    [
      "social sign-up that created the user",
      { path: "/callback/:id", newSession: newUserSession },
    ],
    [
      "social sign-up blocked by the freeze",
      {
        path: "/callback/:id",
        returned: redirect("/login?error=SIGN_UP_DISABLED&error_description=x"),
      },
    ],
    [
      "account linking callback",
      {
        path: "/callback/:id",
        returned: redirect("https://app.teakvault.com/settings"),
      },
    ],
    [
      "Apple form-post bounce",
      {
        path: "/callback/:id",
        returned: redirect("/api/auth/callback/apple?code=c&state=s"),
      },
    ],
    [
      "the redirect that starts a social sign-in",
      {
        path: "/sign-in/social",
        returned: { url: "https://accounts.google.com", redirect: true },
      },
    ],
  ])("ignores %s", (_name: string, input: SignInInput) => {
    expect(
      classifyBetterAuthSignIn({
        newSession: null,
        returned: undefined,
        ...input,
      })
    ).toBeNull();
  });

  test("never carries an unbounded provider id", () => {
    const attempt = classifyBetterAuthSignIn({
      newSession: existingUserSession,
      path: "/callback/:id",
      providerId: "user@example.com",
      returned: undefined,
    });
    expect(attempt?.provider).toBeUndefined();
  });
});

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
          primary: "betterauth",
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
