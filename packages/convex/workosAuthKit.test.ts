/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_01KBYSVN9RVQ1JXACG3MDMQZGA");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_authkit_test");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_authkit");
  vi.stubEnv("WORKOS_WEBHOOK_SECRET", "test_webhook_secret");
});
afterEach(() => vi.unstubAllEnvs());

test.each([
  { disabled: "true", email: "new@example.com", verdict: "Deny" },
  { disabled: "false", email: "new@example.com", verdict: "Allow" },
])(
  "WorkOS registration returns $verdict for $email with freeze=$disabled",
  async ({ disabled, email, verdict }) => {
    vi.stubEnv("SIGNUPS_DISABLED", disabled);
    const t = convexTest(schema, modules);
    const response = await t.mutation(internal.workosAuthKit.authKitAction, {
      action: {
        object: "user_registration_action_context",
        userData: { email },
      },
    });
    expect(response.verdict).toBe(verdict);
    if (verdict === "Deny") {
      expect(response.errorMessage).toBe(SIGNUPS_PAUSED_MESSAGE);
    }
  }
);
