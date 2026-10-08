// The local E2E stack: the WorkOS emulator, a local Convex backend and the web
// app, all on fixed loopback ports. Every value here is test-only and exists
// only in the emulator's memory, so it is safe to commit.

export const EMULATOR_PORT = 4100;
export const EMULATOR_ORIGIN = `http://localhost:${EMULATOR_PORT}`;
export const EMULATOR_CLIENT_ID = "client_01TEAKE2EEMULATOR";
export const EMULATOR_API_KEY = "sk_test_default";
export const EMULATOR_ENVIRONMENT_ID = "environment_01TEAKE2EEMULATOR";
export const EMULATOR_WEBHOOK_SECRET = "whsec_teak_e2e_emulator_only";

// Local Convex backends bind these fixed ports; the web dev server is pinned.
export const LOCAL_APP_ORIGIN = "http://localhost:3000";
export const LOCAL_CONVEX_URL = "http://127.0.0.1:3210";
export const LOCAL_API_ORIGIN = "http://127.0.0.1:3211";

// Values the local Convex deployment needs to trust emulator sessions and
// receive its signed webhooks.
export const EMULATOR_DEPLOYMENT_VARS = {
  WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
  WORKOS_API_KEY: EMULATOR_API_KEY,
  WORKOS_API_BASE_URL: EMULATOR_ORIGIN,
  WORKOS_ENVIRONMENT_ID: EMULATOR_ENVIRONMENT_ID,
  WORKOS_WEBHOOK_SECRET: EMULATOR_WEBHOOK_SECRET,
} as const;

// authkit-nextjs reads these to reach a WorkOS API other than api.workos.com.
export const EMULATOR_WEB_ENV = {
  WORKOS_API_HOSTNAME: "localhost",
  WORKOS_API_PORT: String(EMULATOR_PORT),
  WORKOS_API_HTTPS: "false",
} as const;

export const emulatorSeed = {
  // Teak's WorkOS environment adds the verification claims to session tokens
  // with a JWT template, and the backend requires `email_verified: true`.
  jwtTemplate: {
    content:
      '{"email": {{ user.email }}, "email_verified": {{ user.email_verified }}}',
  },
  webhookEndpoints: [
    {
      endpoint_url: `${LOCAL_API_ORIGIN}/workos/webhook`,
      secret: EMULATOR_WEBHOOK_SECRET,
      events: ["user.created", "user.updated", "user.deleted"],
    },
  ],
};
