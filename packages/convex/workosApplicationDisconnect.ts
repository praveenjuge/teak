import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { sha256 } from "./publicApiHttpShared";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";

const principalValidator = {
  workosUserId: v.string(),
  consentId: v.string(),
  clientId: v.string(),
  externalId: v.optional(v.union(v.string(), v.null())),
  tokenExpiresAt: v.optional(v.number()),
};
const targetValidator = {
  environmentId: v.string(),
  authKitClientId: v.string(),
  authKitDomain: v.string(),
  credentialFingerprint: v.string(),
};
type Fence = Doc<"workosApplicationDisconnects">;
type Start =
  | { status: "denied" }
  | { status: "completed" }
  | {
      status: "pending";
      fenceId: Id<"workosApplicationDisconnects">;
      operationId: string;
    };
const startValidator = v.union(
  v.object({ status: v.literal("denied") }),
  v.object({ status: v.literal("completed") }),
  v.object({
    status: v.literal("pending"),
    fenceId: v.id("workosApplicationDisconnects"),
    operationId: v.string(),
  })
);

// Caller supplies only a previously verified signed principal or live session.
export const begin = internalMutation({
  args: { ...principalValidator, ...targetValidator, operationId: v.string() },
  returns: startValidator,
  handler: async (ctx, args): Promise<Start> => {
    const consents = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    if (consents.length > 1) {
      return { status: "denied" };
    }
    const old = consents[0];
    if (
      old &&
      (old.workosUserId !== args.workosUserId ||
        old.clientId !== args.clientId ||
        (args.externalId !== null &&
          args.externalId !== undefined &&
          args.externalId !== old.userId))
    ) {
      return { status: "denied" };
    }
    // A terminal old receipt must never dispatch a second provider-wide delete,
    // including after a later grant or local AuthKit rollback.
    if (old?.disconnectCompletedAt !== undefined) {
      return { status: "completed" };
    }
    let ownerId = old?.userId;
    if (!ownerId) {
      const owner:
        | { status: "ok"; teakUserId: string }
        | { status: "denied"; reason: string } = await ctx.runQuery(
        internal.workosIdentity.resolveWorkosOwner,
        {
          workosUserId: args.workosUserId,
          ...(args.externalId === undefined
            ? {}
            : { externalId: args.externalId }),
          verification: { kind: "connect" },
        }
      );
      if (owner.status !== "ok") {
        return { status: "denied" };
      }
      ownerId = owner.teakUserId;
    }
    const fences = await ctx.db
      .query("workosApplicationDisconnects")
      .withIndex("by_workosUserId_and_clientId", (q) =>
        q.eq("workosUserId", args.workosUserId).eq("clientId", args.clientId)
      )
      .take(2);
    if (fences.length > 1) {
      return { status: "denied" };
    }
    const fence = fences[0];
    if (
      fence &&
      (fence.userId !== ownerId ||
        fence.environmentId !== args.environmentId ||
        fence.authKitClientId !== args.authKitClientId ||
        fence.authKitDomain !== args.authKitDomain ||
        fence.credentialFingerprint !== args.credentialFingerprint)
    ) {
      return { status: "denied" };
    }
    if (fence && fence.state !== "completed") {
      return {
        status: "pending",
        fenceId: fence._id,
        operationId: fence.operationId,
      };
    }
    // Expired bearer proofs may replay a completed old receipt, but cannot
    // revoke a grant that may since have been renewed outside this installation.
    if (
      args.tokenExpiresAt !== undefined &&
      args.tokenExpiresAt * 1000 <= Date.now()
    ) {
      return { status: "denied" };
    }
    const now = Date.now();
    if (fence?.state === "completed") {
      if (
        old &&
        (old.revokedAt !== undefined || old.firstSeenAt <= fence.startedAt)
      ) {
        await ctx.db.patch(old._id, {
          revokedAt: old.revokedAt ?? fence.startedAt,
          disconnectCompletedAt: fence.completedAt,
        });
        return { status: "completed" };
      }
      if (fence.releaseAfter === undefined || now < fence.releaseAfter) {
        return {
          status: "pending",
          fenceId: fence._id,
          operationId: fence.operationId,
        };
      }
      // Historical unseen tokens may prove only an old logout, never authorize a
      // new application-wide DELETE. All pre-acknowledgement access tokens have
      // expired by this fence; a live token now belongs to a newer provider grant.
      if (
        !old &&
        (args.tokenExpiresAt === undefined || args.tokenExpiresAt * 1000 <= now)
      ) {
        return { status: "denied" };
      }
    }

    const values = {
      operationId: args.operationId,
      userId: ownerId,
      workosUserId: args.workosUserId,
      clientId: args.clientId,
      triggerConsentId: args.consentId,
      environmentId: args.environmentId,
      authKitClientId: args.authKitClientId,
      authKitDomain: args.authKitDomain,
      credentialFingerprint: args.credentialFingerprint,
      ...(args.tokenExpiresAt === undefined
        ? {}
        : { tokenExpiresAt: args.tokenExpiresAt }),
      state: "prepared" as const,
      startedAt: now,
    };
    if (fence) {
      await ctx.db.replace(fence._id, values);
      return {
        status: "pending",
        fenceId: fence._id,
        operationId: args.operationId,
      };
    }
    const fenceId = await ctx.db.insert("workosApplicationDisconnects", values);
    return { status: "pending", fenceId, operationId: args.operationId };
  },
});
export const sessionConsent = internalQuery({
  args: { consentId: v.string(), userId: v.string(), workosUserId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ workosUserId: v.string(), clientId: v.string() })
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    const row = rows[0];
    return rows.length === 1 &&
      row.userId === args.userId &&
      row.workosUserId === args.workosUserId
      ? { workosUserId: row.workosUserId, clientId: row.clientId }
      : null;
  },
});
export const read = internalQuery({
  args: { fenceId: v.id("workosApplicationDisconnects") },
  returns: v.any(),
  handler: (ctx, args) => ctx.db.get(args.fenceId),
});
export const dispatch = internalMutation({
  args: {
    fenceId: v.id("workosApplicationDisconnects"),
    operationId: v.string(),
    applicationId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fenceId);
    if (
      !row ||
      row.operationId !== args.operationId ||
      row.state !== "prepared"
    ) {
      return false;
    }
    if (
      row.tokenExpiresAt !== undefined &&
      row.tokenExpiresAt * 1000 <= Date.now()
    ) {
      return false;
    }
    const trigger = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", row.triggerConsentId))
      .take(2);
    if (
      trigger.length > 1 ||
      (trigger[0] &&
        (trigger[0].userId !== row.userId ||
          trigger[0].workosUserId !== row.workosUserId ||
          trigger[0].clientId !== row.clientId))
    ) {
      return false;
    }
    if (trigger[0]) {
      await ctx.db.patch(trigger[0]._id, {
        revokedAt: trigger[0].revokedAt ?? row.startedAt,
      });
    } else {
      await ctx.db.insert("workosConsents", {
        consentId: row.triggerConsentId,
        userId: row.userId,
        workosUserId: row.workosUserId,
        clientId: row.clientId,
        firstSeenAt: row.startedAt,
        lastSeenAt: row.startedAt,
        revokedAt: row.startedAt,
      });
    }
    await ctx.db.patch(row._id, {
      state: "dispatched",
      dispatchedAt: Date.now(),
      ...(args.applicationId ? { applicationId: args.applicationId } : {}),
    });
    return true;
  },
});
// Pre-dispatch failures have no external uncertainty and must not freeze access.
export const cancelPrepared = internalMutation({
  args: {
    fenceId: v.id("workosApplicationDisconnects"),
    operationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fenceId);
    if (
      !row ||
      row.operationId !== args.operationId ||
      row.state !== "prepared"
    ) {
      return false;
    }
    await ctx.db.delete(row._id);
    return true;
  },
});
export const acknowledge = internalMutation({
  args: {
    fenceId: v.id("workosApplicationDisconnects"),
    operationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fenceId);
    if (
      !row ||
      row.operationId !== args.operationId ||
      row.state !== "dispatched"
    ) {
      return false;
    }
    await ctx.db.patch(row._id, {
      state: "acknowledged",
      providerAcknowledgedAt: Date.now(),
    });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    fenceId: v.id("workosApplicationDisconnects"),
    operationId: v.string(),
    success: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fenceId);
    if (
      !row ||
      row.operationId !== args.operationId ||
      !["dispatched", "acknowledged"].includes(row.state)
    ) {
      return false;
    }
    if (!args.success && row.state !== "dispatched") {
      return false;
    }
    if (!args.success) {
      await ctx.db.patch(row._id, { state: "unknown" });
      return false;
    }
    const now = Date.now();
    if (
      row.state !== "acknowledged" ||
      row.providerAcknowledgedAt === undefined
    ) {
      return false;
    }
    const providerAcknowledgedAt = row.providerAcknowledgedAt;
    const siblings = await ctx.db
      .query("workosConsents")
      .withIndex(
        "by_workosUserId_and_clientId_and_disconnectCompletedAt",
        (q) =>
          q
            .eq("workosUserId", row.workosUserId)
            .eq("clientId", row.clientId)
            .eq("disconnectCompletedAt", undefined)
      )
      .take(100);
    for (const sibling of siblings) {
      if (sibling.userId !== row.userId) {
        throw new Error("Disconnect sibling owner mismatch");
      }
      await ctx.db.patch(sibling._id, {
        revokedAt: sibling.revokedAt ?? row.startedAt,
        disconnectCompletedAt: now,
      });
    }
    if (siblings.length === 100) {
      return false;
    }
    const consent = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", row.triggerConsentId))
      .take(2);
    if (
      consent.length !== 1 ||
      consent[0].userId !== row.userId ||
      consent[0].workosUserId !== row.workosUserId ||
      consent[0].clientId !== row.clientId
    ) {
      throw new Error("Disconnect receipt binding mismatch");
    }
    await ctx.db.patch(row._id, {
      state: "completed",
      completedAt: now,
      releaseAfter: providerAcknowledgedAt + 305_000,
    });
    await ctx.db.patch(consent[0]._id, { disconnectCompletedAt: now });
    // The acknowledged operation retains its fence through the maximum accepted
    // access-token lifetime (300s) plus 5s skew. Unknown dispatch never releases.
    return true;
  },
});
async function providerApplication(
  userId: string,
  clientId: string,
  key: string
) {
  const base = `https://api.workos.com/user_management/users/${encodeURIComponent(userId)}/authorized_applications`;
  let after: string | undefined;
  let found: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const url = new URL(base);
    url.searchParams.set("limit", "100");
    if (after) {
      url.searchParams.set("after", after);
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error("Provider application lookup unavailable");
    }
    const body = await readResponseTextWithinLimit(response, 256 * 1024);
    if (body === null) {
      throw new Error("Provider application lookup oversized");
    }
    const payload = JSON.parse(body) as {
      data?: { application?: { id?: unknown; client_id?: unknown } }[];
      list_metadata?: { after?: unknown };
    };
    if (
      !Array.isArray(payload.data) ||
      payload.data.length > 100 ||
      !payload.list_metadata
    ) {
      throw new Error("Provider application lookup invalid");
    }
    for (const entry of payload.data) {
      const app = entry.application;
      if (
        !app ||
        typeof app.id !== "string" ||
        !/^(?:connect_app_|conn_app_)[A-Za-z0-9]+$/.test(app.id) ||
        typeof app.client_id !== "string"
      ) {
        throw new Error("Provider application binding invalid");
      }
      if (app.client_id === clientId) {
        if (found && found !== app.id) {
          throw new Error("Ambiguous provider application");
        }
        found = app.id;
      }
    }
    const next = payload.list_metadata.after;
    if (next === null || next === undefined || next === "") {
      return found;
    }
    if (
      typeof next !== "string" ||
      next.length > 256 ||
      /[\s\p{Cc}]/u.test(next) ||
      seen.has(next)
    ) {
      throw new Error("Provider application cursor invalid");
    }
    seen.add(next);
    after = next;
  }
  throw new Error("Provider application pagination limit");
}
async function completeAcknowledged(
  ctx: ActionCtx,
  row: Fence
): Promise<number> {
  for (let batch = 0; batch < 100; batch++) {
    const done: boolean = await ctx.runMutation(
      internal.workosApplicationDisconnect.finish,
      { fenceId: row._id, operationId: row.operationId, success: true }
    );
    if (done) {
      return 204;
    }
    const current: Fence | null = await ctx.runQuery(
      internal.workosApplicationDisconnect.read,
      { fenceId: row._id }
    );
    if (
      current?.operationId !== row.operationId ||
      current.state !== "acknowledged"
    ) {
      return 503;
    }
  }
  return 503; // A subsequent request resumes cleanup without provider dispatch.
}
export const run = internalAction({
  args: principalValidator,
  returns: v.number(),
  handler: async (ctx, principal): Promise<number> => {
    const apiKey = process.env.WORKOS_API_KEY;
    const environmentId = process.env.WORKOS_ENVIRONMENT_ID;
    const authKitClientId = process.env.WORKOS_CLIENT_ID;
    const authKitDomain = process.env.WORKOS_AUTHKIT_DOMAIN;
    if (!(apiKey && environmentId && authKitClientId && authKitDomain)) {
      return 503;
    }
    const target = {
      environmentId,
      authKitClientId,
      authKitDomain,
      credentialFingerprint: await sha256(apiKey),
    };
    const started: Start = await ctx.runMutation(
      internal.workosApplicationDisconnect.begin,
      { ...principal, ...target, operationId: crypto.randomUUID() }
    );
    if (started.status === "denied") {
      return 401;
    }
    if (started.status === "completed") {
      return 204;
    }
    const row: Fence | null = await ctx.runQuery(
      internal.workosApplicationDisconnect.read,
      { fenceId: started.fenceId }
    );
    if (!row || row.operationId !== started.operationId) {
      return 503;
    }
    if (row.state === "acknowledged") {
      return completeAcknowledged(ctx, row);
    }
    if (row.state !== "prepared") {
      return 503;
    }
    let applicationId: string | undefined;
    try {
      applicationId = await providerApplication(
        row.workosUserId,
        row.clientId,
        apiKey
      );
    } catch {
      await ctx.runMutation(
        internal.workosApplicationDisconnect.cancelPrepared,
        { fenceId: row._id, operationId: row.operationId }
      );
      return 503;
    }
    // An absent listing cannot prove deletion and races provider reenrollment.
    if (!applicationId) {
      await ctx.runMutation(
        internal.workosApplicationDisconnect.cancelPrepared,
        { fenceId: row._id, operationId: row.operationId }
      );
      return 503;
    }
    const dispatched: boolean = await ctx.runMutation(
      internal.workosApplicationDisconnect.dispatch,
      {
        fenceId: row._id,
        operationId: row.operationId,
        ...(applicationId ? { applicationId } : {}),
      }
    );
    if (!dispatched) {
      await ctx.runMutation(
        internal.workosApplicationDisconnect.cancelPrepared,
        { fenceId: row._id, operationId: row.operationId }
      );
      return 503;
    }
    try {
      if (applicationId) {
        const result = await fetch(
          `https://api.workos.com/user_management/users/${encodeURIComponent(row.workosUserId)}/authorized_applications/${encodeURIComponent(applicationId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          }
        );
        if (result.status !== 204) {
          throw new Error("Provider disconnect outcome uncertain");
        }
      }
      const acknowledged: boolean = await ctx.runMutation(
        internal.workosApplicationDisconnect.acknowledge,
        { fenceId: row._id, operationId: row.operationId }
      );
      if (!acknowledged) {
        return 503;
      }
      return await completeAcknowledged(ctx, row);
    } catch {
      try {
        await ctx.runMutation(internal.workosApplicationDisconnect.finish, {
          fenceId: row._id,
          operationId: row.operationId,
          success: false,
        });
      } catch {
        /* dispatched remains denied */
      }
      return 503;
    }
  },
});
