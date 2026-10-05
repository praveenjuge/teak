/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workflowTest from "@convex-dev/workflow/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { finishAccountDeletion } from "./accountDeletion";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const claims = {
  issuer: "https://api.workos.com/user_management/client_DELETE",
  subject: "user_DELETE",
  sid: "session_DELETE",
  emailVerified: true,
  external_id: "permanent-owner",
};
const fixture = async () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  workflowTest.register(t);
  apiKeysTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      workosUserId: "user_DELETE",
      email: "legacy@example.com",
      emailVerified: true,
      workosEmail: "provider@example.com",
      workosEmailVerified: true,
    })
  );
  const card = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "permanent-owner",
      content: "private",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    })
  );
  return { t, card, signed: t.withIdentity(claims) };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DELETE");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_DELETE");
  vi.stubEnv("WORKOS_API_KEY", "test-workos-account-deletion-key");
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("durable deletion admission and tombstones", () => {
  test("writer scans checkpoint bounded pages and survive lost responses", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(state!._id, { stage: 3 });
      for (let index = 0; index < 45; index++) {
        await ctx.db.insert("exportJobs", {
          userId: "permanent-owner",
          status: "ready",
          createdAt: index,
          updatedAt: index,
        });
      }
      await ctx.db.insert("exportJobs", {
        userId: "sibling",
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const binding = { stateId: state!._id, generation: 1 };
    const scan = () =>
      t.action(internal.accountDeletionData.prepareWriters, binding);
    expect(await scan()).toBe(false); // Empty import page switches to exports.
    const cancelled = () =>
      t.run((ctx) =>
        ctx.db
          .query("exportJobs")
          .withIndex("by_user_created", (q) =>
            q.eq("userId", "permanent-owner")
          )
          .take(50)
      );
    expect(await scan()).toBe(false);
    expect(
      (await cancelled()).filter((row) => row.cancelRequested)
    ).toHaveLength(20);
    expect(await scan()).toBe(false);
    expect(
      (await cancelled()).filter((row) => row.cancelRequested)
    ).toHaveLength(40);
    expect(await scan()).toBe(true);
    expect(
      (await cancelled()).filter((row) => row.cancelRequested)
    ).toHaveLength(45);
    expect(await scan()).toBe(true); // Lost final reply resumes from the committed marker.
    await expect(
      t.action(internal.accountDeletionData.prepareWriters, {
        ...binding,
        generation: 2,
      })
    ).rejects.toThrow("stale_deletion_generation");
    const sibling = await t.run((ctx) =>
      ctx.db
        .query("exportJobs")
        .withIndex("by_user_created", (q) => q.eq("userId", "sibling"))
        .unique()
    );
    expect(sibling?.cancelRequested).toBeUndefined();
  });

  test.each([1, 2])(
    "oversized provider page at stage %s is rejected before revocation",
    async (stage) => {
      const { t, signed } = await fixture();
      await signed.mutation(api.accountDeletion.deleteMyAccount, {});
      const state = await t.run((ctx) =>
        ctx.db.query("accountDeletionStates").unique()
      );
      await t.run((ctx) => ctx.db.patch(state!._id, { stage }));
      let requestedLimit: string | null = null;
      let revocations = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: unknown, options?: RequestInit) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input)
          );
          if (
            options?.method === "DELETE" ||
            url.pathname.endsWith("/sessions/revoke")
          ) {
            revocations++;
            return new Response(null, { status: 204 });
          }
          requestedLimit = url.searchParams.get("limit");
          return Response.json({
            data: Array.from({ length: 11 }, (_, index) =>
              stage === 2
                ? { application: { id: `conn_app_TEST${index}` } }
                : {
                    object: "session",
                    id: `session_TEST${index}`,
                    user_id: "user_DELETE",
                    status: "active",
                    auth_method: "password",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 60_000).toISOString(),
                  }
            ),
            list_metadata: {},
          });
        })
      );
      await expect(
        t.action(internal.accountDeletionActions.runStage, {
          stateId: state!._id,
          generation: 1,
          stage,
        })
      ).rejects.toThrow(
        stage === 2
          ? "deletion_workos_apps_invalid"
          : "deletion_session_page_invalid"
      );
      expect(requestedLimit).toBe("10");
      expect(revocations).toBe(0);
      expect(await t.run((ctx) => ctx.db.get(state!._id))).toMatchObject({
        stage,
      });
    }
  );
  test("application revocation yields between bounded provider pages", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 2 }));
    const applications = new Set(["conn_app_ONE", "conn_app_TWO"]);
    let pages = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (options?.method === "DELETE") {
          applications.delete(
            url.pathname.slice(url.pathname.lastIndexOf("/") + 1)
          );
          return new Response(null, { status: 204 });
        }
        pages++;
        return Response.json({
          data: [...applications]
            .slice(0, 1)
            .map((id) => ({ application: { id } })),
          list_metadata: {},
        });
      })
    );
    const binding = { stateId: state!._id, generation: 1, stage: 2 };
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(false);
    expect(pages).toBe(1);
    expect([...applications]).toEqual(["conn_app_TWO"]);
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(false);
    expect(applications.size).toBe(0);
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(true);
    expect(pages).toBe(3);
  });
  test("a provider failure retains page progress and retries only remaining active sessions", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 1 }));
    const active = new Set(["session_ONE", "session_TWO"]);
    const attempted: string[] = [];
    let unavailable = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.pathname.endsWith("/sessions/revoke")) {
          const id = JSON.parse(options!.body as string).session_id;
          attempted.push(id);
          if (id === "session_TWO" && unavailable) {
            return Response.json(
              { message: "Fixture outage" },
              { status: 503 }
            );
          }
          active.delete(id);
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/sessions")) {
          return Response.json({
            data: ["session_ONE", "session_TWO"].map((id) => ({
              object: "session",
              id,
              user_id: "user_DELETE",
              status: active.has(id) ? "active" : "revoked",
              auth_method: "password",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            })),
            list_metadata: {},
          });
        }
        throw new Error("Unexpected provider operation");
      })
    );
    const binding = { stateId: state!._id, generation: 1, stage: 1 };
    await expect(
      t.action(internal.accountDeletionActions.runStage, binding)
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(state!._id))).toMatchObject({
      stage: 1,
    });
    expect(active).toEqual(new Set(["session_TWO"]));
    unavailable = false;
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(true);
    expect(attempted).toEqual(["session_ONE", "session_TWO", "session_TWO"]);
    expect(active.size).toBe(0);
  });
  test("session revocation resumes past inactive pages without revoking them", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 1 }));
    const requests: string[] = [];
    const revoked: string[] = [];
    const wireSession = (id: string, status: string) => ({
      object: "session",
      id,
      user_id: "user_DELETE",
      status,
      auth_method: "password",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.pathname.endsWith("/sessions/revoke")) {
          revoked.push(JSON.parse(options!.body as string).session_id);
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/sessions")) {
          const after = url.searchParams.get("after") ?? "";
          requests.push(after);
          if (requests.length > 2) {
            return Response.json({ data: [], list_metadata: {} });
          }
          return Response.json(
            after
              ? {
                  data: [wireSession("session_ACTIVE", "active")],
                  list_metadata: {},
                }
              : {
                  data: [
                    wireSession("session_REVOKED", "revoked"),
                    wireSession("session_EXPIRED", "expired"),
                  ],
                  list_metadata: { after: "session_EXPIRED" },
                }
          );
        }
        throw new Error("Unexpected provider operation");
      })
    );
    const binding = { stateId: state!._id, generation: 1, stage: 1 };
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(false);
    expect(revoked).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(state!._id))).toMatchObject({
      providerSessionCursor: "session_EXPIRED",
      stage: 1,
    });
    expect(
      await t.action(internal.accountDeletionActions.runStage, binding)
    ).toBe(true);
    expect(requests).toEqual(["", "session_EXPIRED"]);
    expect(revoked).toEqual(["session_ACTIVE"]);
  });
  test("accepted request preserves owner, captures binding, denies access and schedules once", async () => {
    const { t, signed, card } = await fixture();
    expect(
      await signed.mutation(api.accountDeletion.deleteMyAccount, {})
    ).toBeNull();
    expect(await signed.query(api.cards.getCard, { id: card })).toBeNull();
    const first = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").take(2)
    );
    expect(first).toMatchObject([
      {
        userId: "permanent-owner",
        workosUserId: "user_DELETE",
        generation: 1,
        stage: 0,
        workosTarget: {
          clientId: "client_DELETE",
          environmentId: "environment_DELETE",
        },
      },
    ]);
    expect(
      await signed.mutation(api.accountDeletion.deleteMyAccount, {})
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual(first);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
    });
  });
  test.each([
    { emailVerified: false },
    { sid: "app_consent_WRONG" },
    { issuer: "https://convex.test" },
    { external_id: "another-owner" },
  ])("invalid proof cannot initiate deletion: %j", async (delta) => {
    const { t } = await fixture();
    await expect(
      t
        .withIdentity({ ...claims, ...delta })
        .mutation(api.accountDeletion.deleteMyAccount, {})
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual([]);
  });
  test("stale generation cannot advance or finish an accepted deletion", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await expect(
      t.mutation(internal.accountDeletionJobs.advance, {
        stateId: state!._id,
        generation: 2,
        stage: 0,
      })
    ).rejects.toThrow("stale");
    await expect(
      t.mutation(internal.accountDeletionJobs.finalize, {
        stateId: state!._id,
        generation: 1,
      })
    ).rejects.toThrow("stale");
    expect(await t.run((ctx) => ctx.db.get(state!._id))).toEqual(state);
  });
  test("legacy afterDelete cannot remove a workflow-owned denial state", async () => {
    const { t, signed } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    await t.run((ctx) => finishAccountDeletion(ctx, "permanent-owner"));
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toHaveLength(1);
  });
  test("finalization commits permanent tombstone before removing denial state", async () => {
    const { t, signed, card } = await fixture();
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { stage: 6 }));
    await t.mutation(internal.accountDeletionJobs.finalize, {
      stateId: state!._id,
      generation: 1,
    });
    expect(
      await t.run((ctx) => ctx.db.query("accountDeletionStates").take(2))
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
      deletedAt: expect.any(Number),
    });
    expect(await signed.query(api.cards.getCard, { id: card })).toBeNull();
  });
  test("storage evidence cannot be reassigned and deleting owner cannot register more keys", async () => {
    const { t, signed } = await fixture();
    const key = "users/collision/file";
    expect(
      await t.mutation(internal.storage.ownership.registerObject, {
        userId: "permanent-owner",
        key,
      })
    ).toBe(true);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        teakUserId: "other-owner",
        email: "other@example.com",
        emailVerified: true,
      })
    );
    await expect(
      t.mutation(internal.storage.ownership.registerObject, {
        userId: "other-owner",
        key,
      })
    ).rejects.toThrow("owner_conflict");
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    expect(
      await t.mutation(internal.storage.ownership.registerObject, {
        userId: "permanent-owner",
        key: "users/collision/later",
      })
    ).toBe(false);
    expect(
      await t.query(internal.storage.ownership.getObjectsPage, {
        userId: "permanent-owner",
      })
    ).toMatchObject([{ key }]);
  });
  test("Better Auth denial is immediate even in shadow mode", async () => {
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
    const { t, card } = await fixture();
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: "permanent-owner",
          token: "token",
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const signed = t.withIdentity({
      subject: "permanent-owner",
      issuer: process.env.CONVEX_SITE_URL!,
      sessionId: session._id,
    });
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    expect(await signed.query(api.cards.getCard, { id: card })).toBeNull();
    expect(
      await signed.mutation(api.accountDeletion.deleteMyAccount, {})
    ).toBeNull();
  });
  test("complete stages erase populated disposable data and revoke every provider grant", async () => {
    const { t, signed, card } = await fixture();
    vi.stubEnv("WORKOS_API_KEY", "test-workos-account-deletion-key");
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "disposable-secret");
    const storage = new Set([
      "users/exact/file",
      "users/exact/export.zip",
      "users/exact/unclaimed.pdf",
    ]);
    const sessions = new Set(["session_ONE", "session_TWO"]);
    const applications = new Set(["conn_app_ONE", "conn_app_TWO"]);
    let providerDeleted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        const method =
          options?.method ?? (input instanceof Request ? input.method : "GET");
        if (url.origin === "https://files.test") {
          const body = JSON.parse(options!.body as string) as {
            op: string;
            params: { key?: string; keys?: string[] };
          };
          if (body.op === "freeze-object") {
            return Response.json({ ok: true, data: { frozen: true } });
          }
          if (body.op === "delete-objects") {
            for (const key of body.params.keys!) {
              storage.delete(key);
            }
            return Response.json({
              ok: true,
              data: { deleted: body.params.keys!.length },
            });
          }
          throw new Error(`unexpected_worker_op:${body.op}`);
        }
        if (url.pathname.endsWith("/sessions/revoke")) {
          sessions.delete(JSON.parse(options!.body as string).session_id);
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/sessions")) {
          return Response.json({
            data: [...sessions].map((id) => ({
              object: "session",
              id,
              user_id: "user_DELETE",
              status: "active",
              auth_method: "password",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            })),
            list_metadata: {},
          });
        }
        if (url.pathname.includes("/authorized_applications")) {
          if (method === "DELETE") {
            applications.delete(
              url.pathname.slice(url.pathname.lastIndexOf("/") + 1)
            );
            return new Response(null, { status: 204 });
          }
          return Response.json({
            data: [...applications].map((id) => ({ application: { id } })),
            list_metadata: {},
          });
        }
        if (method === "DELETE" && url.pathname.endsWith("/user_DELETE")) {
          providerDeleted = true;
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `unexpected_provider_request:${method}:${url.pathname}`
        );
      })
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(card, { fileKey: "users/exact/file" });
      await ctx.db.insert("exportJobs", {
        userId: "permanent-owner",
        status: "ready",
        artifactKey: "users/exact/export.zip",
        createdAt: 1,
        updatedAt: 1,
      });
      const jobId = await ctx.db.insert("importJobs", {
        userId: "permanent-owner",
        mode: "archive",
        status: "failed",
        phase: "complete",
        fileName: "archive.zip",
        fileSize: 1,
        fileLastModified: 1,
        sourceKey: "users/exact/source.zip",
        parsedCount: 1,
        processedCount: 1,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("importJobItems", {
        userId: "permanent-owner",
        jobId,
        sourceIndex: 0,
        status: "failed",
        type: "document",
        content: "private",
        extractedFileKey: "users/exact/unclaimed.pdf",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    const binding = { stateId: state!._id, generation: 1 };
    for (let stage = 0; stage < 6; stage++) {
      let done = false;
      while (!done) {
        done = await t.action(internal.accountDeletionActions.runStage, {
          ...binding,
          stage,
        });
      }
      await t.mutation(internal.accountDeletionJobs.advance, {
        ...binding,
        stage,
      });
    }
    await t.mutation(internal.accountDeletionJobs.finalize, binding);
    expect(sessions.size).toBe(0);
    expect(applications.size).toBe(0);
    expect(storage.size).toBe(0);
    expect(providerDeleted).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("cards").take(2))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("exportJobs").take(2))).toEqual(
      []
    );
    expect(
      await t.run((ctx) => ctx.db.query("importJobItems").take(2))
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").first())).toMatchObject({
      teakUserId: "permanent-owner",
      deletedAt: expect.any(Number),
    });
  });
});

// Failure modes: unbounded cleanup times out; retries lose their cursor;
// stale generations revoke a different account; sibling grants are touched.
test("local consent cleanup yields and resumes atomically across action retries", async () => {
  const { t, signed } = await fixture();
  await t.run(async (ctx) => {
    for (let n = 0; n < 250; n++) {
      await ctx.db.insert("workosConsents", {
        consentId: `app_consent_DELETE${n}`,
        userId: "permanent-owner",
        workosUserId: "user_DELETE",
        clientId: "client_test",
        firstSeenAt: n,
        lastSeenAt: n,
      });
    }
    await ctx.db.insert("workosConsents", {
      consentId: "app_consent_OTHER",
      userId: "other-owner",
      workosUserId: "user_OTHER",
      clientId: "client_test",
      firstSeenAt: 0,
      lastSeenAt: 0,
    });
  });
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  if (!state) {
    throw new Error("Missing deletion state");
  }
  const binding = { stateId: state._id, generation: 1, stage: 0 };
  const revoked = () =>
    t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("workosConsents")
            .withIndex("by_userId_and_firstSeenAt", (q) =>
              q.eq("userId", "permanent-owner")
            )
            .take(251)
        ).filter((row) => row.revokedAt !== undefined).length
    );
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(false);
  expect(await revoked()).toBe(100);
  // A fresh action invocation represents retry after a lost response.
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(false);
  expect(await revoked()).toBe(200);
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(true);
  expect(await revoked()).toBe(250);
  expect(
    await t.action(internal.accountDeletionActions.runStage, binding)
  ).toBe(true);
  expect(await revoked()).toBe(250);
  await expect(
    t.action(internal.accountDeletionActions.runStage, {
      ...binding,
      generation: 2,
    })
  ).rejects.toThrow("stale_deletion_generation");
  const sibling = await t.run((ctx) =>
    ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", "app_consent_OTHER"))
      .unique()
  );
  expect(sibling?.revokedAt).toBeUndefined();
});

test("account-change pause denies fresh deletion and acknowledges an existing durable request", async () => {
  const { t, signed } = await fixture();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  await expect(
    signed.mutation(api.accountDeletion.deleteMyAccount, {})
  ).rejects.toThrow("Account changes are paused");
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").collect())
  ).toEqual([]);
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  await expect(
    signed.mutation(api.accountDeletion.deleteMyAccount, {})
  ).resolves.toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").collect())
  ).toHaveLength(1);
});
