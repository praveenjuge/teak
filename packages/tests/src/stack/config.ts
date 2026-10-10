// The E2E stack: the WorkOS emulator, a local Convex backend and the web app.
// Ports belong to the checkout (scripts/worktree-env.ts), so every worktree
// runs its own stack. Every WorkOS value here is test-only and exists only in
// the emulator's memory, so it is safe to commit. The running stack records
// itself in the state file `bun run dev` also uses (scripts/lib/stack-state.ts).

import type { StackUrls } from "../../../../scripts/lib/stack-state.ts";
import type { WorktreePorts } from "../../../../scripts/worktree-env.ts";

export type StackPorts = Pick<
  WorktreePorts,
  "convex" | "convexSite" | "emulator" | "web"
>;

export const EMULATOR_CLIENT_ID = "client_01TEAKE2EEMULATOR";
export const EMULATOR_API_KEY = "sk_test_default";
export const EMULATOR_ENVIRONMENT_ID = "environment_01TEAKE2EEMULATOR";
export const EMULATOR_WEBHOOK_SECRET = "whsec_teak_e2e_emulator_only";
// Seals the E2E web app's AuthKit sessions. Test-only, like the values above.
export const EMULATOR_COOKIE_PASSWORD =
  "teak-e2e-emulator-cookie-password-0001";

export const stackUrls = (ports: StackPorts): Required<StackUrls> => ({
  appOrigin: `http://localhost:${ports.web}`,
  convexUrl: `http://127.0.0.1:${ports.convex}`,
  apiOrigin: `http://127.0.0.1:${ports.convexSite}`,
  emulatorOrigin: `http://localhost:${ports.emulator}`,
});

// Values the local Convex deployment needs to trust emulator sessions and
// receive its signed webhooks.
export const emulatorDeploymentVars = (ports: StackPorts) => ({
  WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
  WORKOS_API_KEY: EMULATOR_API_KEY,
  WORKOS_API_BASE_URL: stackUrls(ports).emulatorOrigin,
  WORKOS_ENVIRONMENT_ID: EMULATOR_ENVIRONMENT_ID,
  WORKOS_WEBHOOK_SECRET: EMULATOR_WEBHOOK_SECRET,
});

// The E2E web app's settings. The stack passes them as process environment,
// which Next.js prefers over apps/web/.env.local, so the E2E stack never
// rewrites the dev wiring in that file. authkit-nextjs reads WORKOS_API_* to
// reach a WorkOS API other than api.workos.com.
export const emulatorWebEnv = (ports: StackPorts) => {
  const urls = stackUrls(ports);
  return {
    NEXT_PUBLIC_CONVEX_URL: urls.convexUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: urls.apiOrigin,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${urls.appOrigin}/callback`,
    WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
    WORKOS_API_KEY: EMULATOR_API_KEY,
    WORKOS_COOKIE_PASSWORD: EMULATOR_COOKIE_PASSWORD,
    WORKOS_API_HOSTNAME: "localhost",
    WORKOS_API_PORT: String(ports.emulator),
    WORKOS_API_HTTPS: "false",
  };
};

export const emulatorSeed = (ports: StackPorts) => ({
  // Teak's WorkOS environment adds the verification claims to session tokens
  // with a JWT template, and the backend requires `email_verified: true`.
  jwtTemplate: {
    content:
      '{"email": {{ user.email }}, "email_verified": {{ user.email_verified }}}',
  },
  webhookEndpoints: [
    {
      endpoint_url: `${stackUrls(ports).apiOrigin}/workos/webhook`,
      secret: EMULATOR_WEBHOOK_SECRET,
      events: ["user.created", "user.updated", "user.deleted"],
    },
  ],
});
