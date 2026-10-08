/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}
// Under WorkOS the legacy credential gate stops Better Auth grant writes.
const selectWorkos = () => vi.stubEnv("AUTH_PRIMARY", "workos");
const codeValue = (requireConsent = false) => ({
  clientId: "teak-cli",
  userId: "permanent",
  redirectURI: "http://127.0.0.1:14210/callback",
  scope: ["openid", "profile", "email", "offline_access"],
  authTime: 1,
  requireConsent,
  state: null,
  codeChallenge: "a".repeat(43),
  codeChallengeMethod: "s256",
});
const codeId = () => crypto.randomUUID().replaceAll("-", "");
const row = (identifier: string, value: unknown) => ({
  identifier,
  value: typeof value === "string" ? value : JSON.stringify(value),
  expiresAt: Date.now() + 600_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
const rows = (t: ReturnType<typeof setup>) =>
  t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "verification",
      paginationOpts: { cursor: null, numItems: 100 },
    })
  );
// Failure modes: a grant admitted before the switch lands afterward; malformed
// potential grants mistaken for safe data; reset/replay records blocked.
test("verification triggers deny consent/code/social grants under WorkOS while unrelated records work", async () => {
  const t = setup();
  let admitted:
    | ReturnType<ReturnType<typeof authComponent.adapter>>
    | undefined;
  await t.run((ctx) => {
    admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
    return Promise.resolve(null);
  });
  const getAdmitted = () => {
    if (!admitted) {
      throw new Error("Missing adapter");
    }
    return admitted;
  };
  const create = (identifier: string, value: unknown) =>
    t.run(() =>
      getAdmitted().create({
        model: "verification",
        data: {
          ...row(identifier, value),
          expiresAt: new Date(Date.now() + 600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    );
  const existing = await create(codeId(), codeValue(true));
  const unrelated = await create("email-verification:retained", "signed-token");
  selectWorkos();
  await expect(create(codeId(), codeValue())).rejects.toThrow(
    "credential writes are stopped"
  );
  const id = `_${"b".repeat(30)}-`;
  await expect(
    create(id, {
      callbackURL: "http://localhost:3000",
      codeVerifier: "a".repeat(128),
      expiresAt: Date.now() + 600_000,
      oauthState: id,
    })
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "verification",
        where: [{ field: "id", value: existing.id }],
        update: {
          identifier: "email-verification:converted",
          value: "not-a-grant",
        },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "verification",
        where: [{ field: "id", value: unrelated.id }],
        update: { identifier: codeId(), value: JSON.stringify(codeValue()) },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    create(codeId(), { ...codeValue(), scope: "bad" })
  ).rejects.toThrow("Ambiguous legacy grant");
  expect(await create("reset-password:retained", "permanent")).toHaveProperty(
    "id"
  );
  expect(
    await create(`teak-oauth-used-refresh:${"b".repeat(64)}`, {
      clientId: "teak-cli",
      userId: "permanent",
    })
  ).toHaveProperty("id");
  expect((await rows(t)).page).toHaveLength(4);
});

// Under WorkOS the legacy session no longer authenticates, so the refusal
// comes before the credential gate; either way nothing is written.
test("native code creation is refused under WorkOS and writes nothing", async () => {
  const t = setup();
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: "permanent",
          token: crypto.randomUUID(),
          expiresAt: Date.now() + 600_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
  const signed = t.withIdentity({
    issuer: process.env.CONVEX_SITE_URL!,
    subject: "permanent",
    sessionId: session._id,
  });
  const verifier = "a".repeat(43);
  const challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      )
    )
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const args = {
    deviceId: "desktop-device-123456",
    state: "state_123456789012",
    codeChallenge: challenge,
    surface: "desktop" as const,
  };
  await signed.mutation(api.authNative.createNativeAuthCode, args);
  selectWorkos();
  await expect(
    signed.mutation(api.authNative.createNativeAuthCode, args)
  ).rejects.toThrow("UNAUTHENTICATED");
  expect(
    await t.run((ctx) => ctx.db.query("nativeAuthCodes").collect())
  ).toHaveLength(1);
});
