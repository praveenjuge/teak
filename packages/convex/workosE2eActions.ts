"use node";

import { createHash } from "node:crypto";
import { NotFoundException, type User, WorkOS } from "@workos-inc/node";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { isE2EEmail } from "./e2eAccounts";
import type { E2ECleanupResult } from "./e2eCleanup";

const clockSkew = 5 * 60 * 1000;
const exactMaximum = 24 * 60 * 60 * 1000;
const orphanMinimum = 30 * 60 * 1000;
const orphanMaximum = 90 * 24 * 60 * 60 * 1000;

async function target(ctx: ActionCtx) {
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  const environmentId = process.env.WORKOS_ENVIRONMENT_ID;
  if (!(apiKey && clientId && environmentId)) {
    throw new Error("E2E target unavailable");
  }
  const pins = {
    clientId,
    environmentId,
    credentialFingerprint: createHash("sha256").update(apiKey).digest("hex"),
  };
  const validate = () => ctx.runQuery(internal.workosE2eState.admission, pins);
  const { domain, witness } = await validate();
  const workos = new WorkOS(apiKey, {
    clientId,
    maxRetries: 0,
    timeout: 10_000,
  });
  if ((await workos.userManagement.getUser(witness)).id !== witness) {
    throw new Error("E2E witness mismatch");
  }
  await validate();
  return { workos, domain, validate, clientId, environmentId };
}

function eligible(user: User, email: string, domain: string, orphan: boolean) {
  const age = Date.now() - Date.parse(user.createdAt);
  return (
    /^user_[A-Za-z0-9]+$/.test(user.id) &&
    user.email.trim().toLowerCase() === email &&
    isE2EEmail(email, domain) &&
    user.metadata?.teak_e2e === "v1" &&
    Number.isFinite(age) &&
    age >= (orphan ? orphanMinimum : -clockSkew) &&
    age <= (orphan ? orphanMaximum : exactMaximum) + clockSkew
  );
}

export const provision = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const { workos, domain, validate } = await target(ctx);
    if (
      !isE2EEmail(email, domain) ||
      email !== email.trim().toLowerCase() ||
      password.length < 8 ||
      password.length > 128
    ) {
      throw new Error("Invalid E2E provisioning request");
    }
    const found = await workos.userManagement.listUsers({ email, limit: 2 });
    if (found.data.length > 1 || found.listMetadata.after) {
      throw new Error("E2E provider conflict");
    }
    const existing = found.data[0];
    if (
      existing &&
      !(eligible(existing, email, domain, false) && existing.emailVerified)
    ) {
      return { status: 409, body: { code: "E2E_ACCOUNT_CONFLICT" } };
    }
    await validate();
    const user =
      existing ??
      (await workos.userManagement.createUser({
        email,
        password,
        emailVerified: true,
        name: "Production E2E",
        metadata: { teak_e2e: "v1" },
      }));
    if (!(eligible(user, email, domain, false) && user.emailVerified)) {
      throw new Error("E2E provider creation mismatch");
    }
    // A real signed webhook must create the canonical profile and permanent owner.
    // A bounded response stays pending if delivery is delayed; no event fabrication.
    for (let attempt = 0; attempt < 10; attempt++) {
      await validate();
      if (
        await ctx.runQuery(internal.workosE2eState.readiness, {
          email,
          workosUserId: user.id,
        })
      ) {
        return { status: existing ? 409 : 200, body: { email } };
      }
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return { status: 503, body: { code: "E2E_PROVISION_PENDING" } };
  },
});

const cursorSchema = z
  .object({
    providerAfter: z.string().max(1024).nullable(),
    providerDone: z.boolean(),
    ownerCursor: z.string().max(4096).nullable(),
    ownerDone: z.boolean(),
    clientId: z.string().max(256),
    environmentId: z.string().max(256),
  })
  .strict();

export const cleanup = internalAction({
  args: {
    emails: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { emails, cursor }) => {
    const { workos, domain, validate, clientId, environmentId } =
      await target(ctx);
    const result: E2ECleanupResult = {
      alreadyDeleted: [],
      deleted: [],
      failures: [],
      ignoredOutOfRange: [],
      remainingEligible: false,
    };
    const exact = emails !== undefined;
    if (exact && cursor !== undefined) {
      throw new Error("Exact cleanup cannot use a sweep cursor");
    }
    const progress = cursor
      ? cursorSchema.parse(JSON.parse(cursor))
      : {
          providerAfter: null,
          providerDone: false,
          ownerCursor: null,
          ownerDone: false,
          clientId,
          environmentId,
        };
    if (
      progress.clientId !== process.env.WORKOS_CLIENT_ID ||
      progress.environmentId !== process.env.WORKOS_ENVIRONMENT_ID
    ) {
      throw new Error("E2E sweep target changed");
    }
    if (
      emails &&
      (!emails.length ||
        emails.length > 20 ||
        emails.some(
          (email) =>
            email !== email.trim().toLowerCase() || !isE2EEmail(email, domain)
        ))
    ) {
      throw new Error("Invalid E2E cleanup request");
    }
    const candidates = new Map<string, User | null>();
    if (emails) {
      for (const email of new Set(emails)) {
        await validate();
        const page = await workos.userManagement.listUsers({ email, limit: 2 });
        if (page.data.length > 1 || page.listMetadata.after) {
          throw new Error("E2E provider conflict");
        }
        candidates.set(email, page.data[0] ?? null);
      }
    } else {
      if (!progress.providerDone) {
        await validate();
        const page = await workos.userManagement.listUsers({
          limit: 20,
          order: "asc",
          after: progress.providerAfter ?? undefined,
        });
        if (page.data.length > 20) {
          throw new Error("E2E provider page oversized");
        }
        const seenEmails = new Set<string>();
        for (const user of page.data) {
          const email = user.email.trim().toLowerCase();
          if (isE2EEmail(email, domain) && seenEmails.has(email)) {
            throw new Error("E2E duplicate provider email");
          }
          seenEmails.add(email);
          if (eligible(user, email, domain, true)) {
            candidates.set(email, user);
          }
        }
        const after = page.listMetadata.after ?? null;
        if (after && after === progress.providerAfter) {
          throw new Error("E2E provider cursor cycle");
        }
        progress.providerAfter = after;
        progress.providerDone = after === null;
      }
      if (!progress.ownerDone) {
        const page = await ctx.runQuery(internal.workosE2eState.orphanOwners, {
          cursor: progress.ownerCursor,
        });
        for (const owner of page.owners) {
          if (candidates.has(owner.email)) {
            continue;
          }
          await validate();
          try {
            candidates.set(
              owner.email,
              await workos.userManagement.getUser(owner.workosUserId)
            );
          } catch (error) {
            if (!(error instanceof NotFoundException)) {
              throw error;
            }
            await validate();
            candidates.set(owner.email, null);
          }
        }
        if (
          !page.done &&
          (!page.cursor || page.cursor === progress.ownerCursor)
        ) {
          throw new Error("E2E owner cursor cycle");
        }
        progress.ownerCursor = page.cursor;
        progress.ownerDone = page.done;
      }
    }
    let pending = false;
    for (const [email, user] of candidates) {
      try {
        await validate();
        const owner = await ctx.runQuery(internal.workosE2eState.ownerByEmail, {
          email,
        });
        if (!user) {
          if (!owner || owner.completed) {
            result.alreadyDeleted.push(email);
          } else if (owner.pending) {
            pending = true;
            result.failures.push({ email, reason: "account cleanup pending" });
          } else {
            throw new Error("Provider absence does not prove local cleanup");
          }
          continue;
        }
        if (!eligible(user, email, domain, !exact)) {
          result.ignoredOutOfRange.push(email);
          continue;
        }
        if (owner?.workosUserId !== user.id || owner.completed) {
          throw new Error("E2E immutable binding conflict");
        }
        await ctx.runMutation(internal.workosE2eState.beginCleanup, {
          email,
          workosUserId: user.id,
          providerCreatedAt: Date.parse(user.createdAt),
          orphan: !exact,
        });
        const status = await ctx.runQuery(
          internal.accountDeletionJobs.getDeletionStatus,
          {
            userId: owner.userId,
            email,
            workosUserId: user.id,
          }
        );
        if (status.status === "completed") {
          result.deleted.push(email);
        } else if (status.status === "pending") {
          pending = true;
          result.failures.push({ email, reason: "account cleanup pending" });
        } else {
          throw new Error("E2E durable cleanup unavailable");
        }
      } catch {
        result.failures.push({ email, reason: "account cleanup failed" });
      }
    }
    const failed =
      result.ignoredOutOfRange.length > 0 ||
      result.failures.some(
        (failure) => failure.reason !== "account cleanup pending"
      );
    const nextCursor =
      exact || (progress.providerDone && progress.ownerDone)
        ? null
        : JSON.stringify(progress);
    result.remainingEligible = nextCursor !== null;
    const successStatus = pending ? 202 : 200;
    return {
      status: failed ? 500 : successStatus,
      body: { ...result, nextCursor },
    };
  },
});
