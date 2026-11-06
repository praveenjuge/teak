import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import schema from "../schema";
import { workosIssuer } from "../shared/workosApi";

/**
 * Every backend module. The glob is rooted here, one folder below
 * `packages/convex`, so function paths match `api` and `internal` wherever the
 * test file sits.
 */
export const modules = import.meta.glob("../**/*.ts");

/**
 * A fresh backend on the real schema, with the rate limiter component that
 * card writes and sign-in checks call. Register any other component
 * (`polarTest`, `apiKeysTest`) on the result. `transactionLimits` enforces
 * Convex's per-function read and write limits, as `convexTest` documents.
 */
export const newBackend = (
  options: {
    transactionLimits?: Parameters<typeof convexTest>[0]["transactionLimits"];
  } = {}
) => {
  const t = convexTest({ schema, modules, ...options });
  rateLimiterTest.register(t, "rateLimiterV2");
  return t;
};

export type Backend = ReturnType<typeof newBackend>;

type Claims = Record<string, string | boolean | undefined>;

/**
 * The claims of a WorkOS session token for `workosUserId`, issued for the
 * client ID `auth.config.ts` trusts, before Teak has stamped a Teak user ID
 * on the WorkOS user (as at first sign-in). `claims` adds or replaces any.
 */
export const workosClaims = (workosUserId: string, claims: Claims = {}) => ({
  issuer: workosIssuer(process.env.WORKOS_CLIENT_ID ?? ""),
  subject: workosUserId,
  email_verified: true,
  ...claims,
});

/**
 * The claims of a WorkOS session token for an existing Teak user, carrying
 * their Teak user ID as `external_id`. `claims` adds or replaces any of them.
 */
export const workosIdentity = (
  workosUserId: string,
  teakUserId: string,
  claims: Claims = {}
) =>
  workosClaims(workosUserId, {
    // WorkOS session IDs are `session_` and letters or digits only.
    sid: `session_${teakUserId.replace(/[^A-Za-z0-9]/g, "")}`,
    external_id: teakUserId,
    ...claims,
  });

/**
 * Seeds a verified WorkOS user for `teakUserId` and returns the backend signed
 * in as them.
 */
export const signIn = async (t: Backend, teakUserId: string, claims?: Claims) =>
  t.withIdentity(
    workosIdentity(await seedWorkosOwner(t, teakUserId), teakUserId, claims)
  );

export type SignedIn = Awaited<ReturnType<typeof signIn>>;
