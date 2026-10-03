/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_01KBYSVN9RVQ1JXACG3MDMQZGA");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_readiness_test");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_readiness");
  vi.stubEnv("WORKOS_WEBHOOK_SECRET", "test_webhook_secret");
  vi.stubEnv("E2E_EMAIL_DOMAIN", "e2e.invalid");
});
afterEach(() => vi.unstubAllEnvs());

test.each([
  { disabled: "true", email: "new@example.com", verdict: "Deny" },
  { disabled: "false", email: "new@example.com", verdict: "Allow" },
  { disabled: "true", email: "ordinary@e2e.invalid", verdict: "Deny" },
  { disabled: "true", email: "e2e-test@e2e.invalid", verdict: "Allow" },
])(
  "WorkOS registration returns $verdict for $email with freeze=$disabled",
  async ({ disabled, email, verdict }) => {
    vi.stubEnv("SIGNUPS_DISABLED", disabled);
    const t = convexTest(schema, modules);
    const response = await t.mutation(
      internal.migration.workosReadiness.authKitAction,
      {
        action: {
          object: "user_registration_action_context",
          userData: { email },
        },
      }
    );
    expect(response.verdict).toBe(verdict);
    if (verdict === "Deny") {
      expect(response.errorMessage).toBe(SIGNUPS_PAUSED_MESSAGE);
    }
  }
);
