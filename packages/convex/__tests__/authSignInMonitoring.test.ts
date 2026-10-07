import { describe, expect, mock, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { authSignInMonitoring } from "../authSignInMonitoring";

// A real Better Auth instance with an in-memory database, so the after-hook
// runs through Better Auth's own dispatch exactly as in production.
const BASE = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

const createTestAuth = (scheduler: { runAfter: ReturnType<typeof mock> }) =>
  betterAuth({
    baseURL: BASE,
    secret: "test-secret-test-secret-test-secret-0123",
    database: memoryAdapter({
      account: [],
      session: [],
      user: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    plugins: [authSignInMonitoring({ scheduler }, "e2e.example.org")],
  });

const post = (
  auth: ReturnType<typeof createTestAuth>,
  path: string,
  body: unknown,
  cookie?: string
) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );

const scheduled = (scheduler: { runAfter: ReturnType<typeof mock> }) =>
  scheduler.runAfter.mock.calls.map((call: unknown[]) => call[2]);

describe("Better Auth sign-in monitoring", () => {
  test("records one outcome per sign-in attempt and nothing for sign-up, refresh or sign-out", async () => {
    const scheduler = { runAfter: mock().mockResolvedValue(null) };
    const auth = createTestAuth(scheduler);

    const signUp = await post(auth, "/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: PASSWORD,
    });
    expect(signUp.status).toBe(200);
    expect(scheduled(scheduler)).toEqual([]);

    const wrong = await post(auth, "/sign-in/email", {
      email: "person@example.com",
      password: "wrong password entirely",
    });
    expect(wrong.status).toBe(401);
    const right = await post(auth, "/sign-in/email", {
      email: "person@example.com",
      password: PASSWORD,
    });
    expect(right.status).toBe(200);
    const cookie = right.headers.get("set-cookie") ?? "";

    const session = await auth.handler(
      new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } })
    );
    expect(session.status).toBe(200);
    const signOut = await post(auth, "/sign-out", {}, cookie);
    expect(signOut.status).toBe(200);

    expect(scheduled(scheduler)).toEqual([
      {
        method: "email",
        outcome: "failure",
        reason: "invalid_email_or_password",
        stage: "sign_in",
        synthetic: false,
      },
      {
        method: "email",
        outcome: "success",
        reason: "ok",
        stage: "sign_in",
        synthetic: false,
      },
    ]);
    expect(JSON.stringify(scheduled(scheduler))).not.toContain("person@");
  });

  test("marks E2E fixtures as synthetic for baseline exclusion", async () => {
    const scheduler = { runAfter: mock().mockResolvedValue(null) };
    const auth = createTestAuth(scheduler);
    await post(auth, "/sign-in/email", {
      email: "e2e-run-1@e2e.example.org",
      password: "no such fixture yet",
    });
    expect(scheduled(scheduler)).toMatchObject([
      { outcome: "failure", synthetic: true },
    ]);
  });

  test("a failing scheduler never changes the sign-in response", async () => {
    const scheduler = {
      runAfter: mock().mockRejectedValue(new Error("scheduler down")),
    };
    const auth = createTestAuth(scheduler);
    await post(auth, "/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: PASSWORD,
    });
    const right = await post(auth, "/sign-in/email", {
      email: "person@example.com",
      password: PASSWORD,
    });
    expect(right.status).toBe(200);
    expect(((await right.json()) as { user?: unknown }).user).toBeTruthy();
    const wrong = await post(auth, "/sign-in/email", {
      email: "person@example.com",
      password: "wrong password entirely",
    });
    expect(wrong.status).toBe(401);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(2);
  });
});
