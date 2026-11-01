import type { WorktreePorts } from "../../../../scripts/dev/worktree-env.ts";
import type { StackUrls } from "../../../../scripts/lib/stack-state.ts";

export type StackPorts = Pick<
  WorktreePorts,
  | "convex"
  | "convexSite"
  | "emulator"
  | "emulatorUpstream"
  | "coreWorker"
  | "coreWorkerInspector"
  | "web"
>;

export const LOCAL_STACK: { readonly fetchesLinks: boolean } = {
  fetchesLinks: false,
};

export const EMULATOR_CLIENT_ID = "client_01TEAKE2EEMULATOR";
export const EMULATOR_API_KEY = "sk_test_default";
/** Test-only; signs what the Core Worker's email handler posts to the local backend. */
export const E2E_EMAIL_INBOUND_SIGNING_SECRET =
  "teak-e2e-email-inbound-signing-secret-local-only-0001";
export const EMULATOR_COOKIE_PASSWORD =
  "teak-e2e-emulator-cookie-password-0001";

export const coreWorkerOrigin = (ports: Pick<StackPorts, "coreWorker">) =>
  `http://127.0.0.1:${ports.coreWorker}`;

export const stackUrls = (ports: StackPorts): Required<StackUrls> => ({
  appOrigin: `http://localhost:${ports.web}`,
  convexUrl: `http://127.0.0.1:${ports.convex}`,
  apiOrigin: `http://127.0.0.1:${ports.convexSite}`,
  emulatorOrigin: `http://localhost:${ports.emulator}`,
});

export const emulatorDeploymentVars = (ports: StackPorts) => ({
  WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
  WORKOS_API_KEY: EMULATOR_API_KEY,
  WORKOS_API_BASE_URL: stackUrls(ports).emulatorOrigin,
  EMAIL_INBOUND_SIGNING_SECRET: E2E_EMAIL_INBOUND_SIGNING_SECRET,
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
    NEXT_PUBLIC_FILES_BASE: coreWorkerOrigin(ports),
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${urls.appOrigin}/callback`,
    WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
    WORKOS_COOKIE_PASSWORD: EMULATOR_COOKIE_PASSWORD,
    WORKOS_API_HOSTNAME: "localhost",
    WORKOS_API_PORT: String(ports.emulator),
    WORKOS_API_HTTPS: "false",
  };
};

export const emulatorSeed = () => ({
  // Teak's WorkOS environment adds the address, its verification and the
  // name to session tokens with a JWT template, and the backend requires
  // `email_verified: true`.
  jwtTemplate: {
    content:
      '{"email": {{ user.email }}, "email_verified": {{ user.email_verified }}, "name": {{ user.name }}, "first_name": {{ user.first_name }}, "last_name": {{ user.last_name }}}',
  },
});
