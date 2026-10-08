"use node";

import { createHash, randomBytes } from "node:crypto";
import { NotFoundException, type User, WorkOS } from "@workos-inc/node";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { isE2EEmail } from "./e2eAccounts";

interface E2ECleanupResult {
  alreadyDeleted: string[];
  deleted: string[];
  failures: { email: string; reason: string }[];
  ignoredOutOfRange: string[];
  remainingEligible: boolean;
}

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
  return { workos, domain, validate, clientId, environmentId, pins };
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

type Target = Awaited<ReturnType<typeof target>>;
type Reservation = Doc<"e2eSignupReservations">;
const reservationKey = "teak_e2e_reservation";

async function providerUser(t: Target, email: string) {
  await t.validate();
  const page = await t.workos.userManagement.listUsers({ email, limit: 2 });
  if (page.data.length > 1 || page.listMetadata.after) {
    throw new Error("E2E provider conflict");
  }
  return page.data[0] ?? null;
}

const flagged = (user: User, reservation: Reservation) => {
  const metadata = user.metadata ?? {};
  return (
    Object.keys(metadata).length === 2 &&
    metadata.teak_e2e === "v1" &&
    metadata[reservationKey] === reservation._id
  );
};

// Pins the exact provider user to the reservation before writing the provider
// flag, then proves the write by re-reading. Foreign metadata fails closed.
// A subset of our two keys is accepted only for the user already bound here,
// so an interrupted write can be completed but never adopted from elsewhere.
async function claim(
  ctx: ActionCtx,
  t: Target,
  reservation: Reservation,
  user: User
): Promise<User> {
  const createdAt = Date.parse(user.createdAt);
  const metadata = Object.entries(user.metadata ?? {});
  const ours = metadata.every(
    ([key, value]) =>
      (key === "teak_e2e" && value === "v1") ||
      (key === reservationKey && value === reservation._id)
  );
  if (
    user.email.trim().toLowerCase() !== reservation.email ||
    !ours ||
    !(
      metadata.length === 0 ||
      flagged(user, reservation) ||
      reservation.workosUserId === user.id
    )
  ) {
    throw new Error("E2E reservation evidence mismatch");
  }
  await t.validate();
  await ctx.runMutation(internal.workosE2eReservations.bind, {
    ...t.pins,
    id: reservation._id,
    workosUserId: user.id,
    providerCreatedAt: createdAt,
  });
  if (flagged(user, reservation)) {
    return user;
  }
  await t.validate();
  await t.workos.userManagement.updateUser({
    userId: user.id,
    metadata: { teak_e2e: "v1", [reservationKey]: reservation._id },
  });
  return await reread(t, reservation, user);
}

// A fresh provider read of the exact bound, flagged identity.
async function reread(t: Target, reservation: Reservation, user: User) {
  await t.validate();
  const current = await t.workos.userManagement.getUser(user.id);
  if (
    current.id !== user.id ||
    current.email.trim().toLowerCase() !== reservation.email ||
    current.createdAt !== user.createdAt ||
    !flagged(current, reservation)
  ) {
    throw new Error("E2E reservation flag unproven");
  }
  return current;
}

async function providerAbsent(t: Target, workosUserId: string) {
  await t.validate();
  try {
    await t.workos.userManagement.getUser(workosUserId);
    return false;
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }
    return true;
  }
}

// Resolves one open reservation for cleanup. Returns the flagged provider user
// for the existing owner-bound deletion path, or a terminal outcome.
async function settle(
  ctx: ActionCtx,
  t: Target,
  reservation: Reservation,
  user: User | null
): Promise<{ user: User | null } | { outcome: "deleted" | "pending" }> {
  const close = (reason: "provider_deleted" | "absent_past_window") =>
    ctx.runMutation(internal.workosE2eReservations.close, {
      ...t.pins,
      id: reservation._id,
      reason,
    });
  const owner = () =>
    ctx.runQuery(internal.workosE2eState.ownerByEmail, {
      email: reservation.email,
    });
  if (!user) {
    if (reservation.workosUserId) {
      if (!(await providerAbsent(t, reservation.workosUserId))) {
        throw new Error("E2E bound provider user moved");
      }
      const current = await owner();
      if (!current || current.completed) {
        await close("provider_deleted");
      }
    } else if (Date.now() > reservation.expiresAt + orphanMaximum + clockSkew) {
      await close("absent_past_window");
    } else {
      // Absence does not prove a submitted signup cannot still land, so an
      // open unbound lease is never reported as cleaned up.
      return { outcome: "pending" };
    }
    return { user: null };
  }
  const claimed = await claim(ctx, t, reservation, user);
  if (await owner()) {
    return { user: claimed };
  }
  // The listing may be stale. A verified user may still be gaining its owner
  // through the webhook, so it is never stamped for ownerless deletion.
  if ((await reread(t, reservation, claimed)).emailVerified) {
    return { outcome: "pending" };
  }
  await t.validate();
  await ctx.runMutation(internal.workosE2eReservations.beginOwnerlessDeletion, {
    ...t.pins,
    id: reservation._id,
    workosUserId: claimed.id,
  });
  // The stamp now denies owner creation for this identity in linkWorkosUser.
  // A user verified since the last read is still left for review, not deleted.
  if ((await reread(t, reservation, claimed)).emailVerified) {
    throw new Error("E2E ownerless deletion refused after verification");
  }
  await t.validate();
  await t.workos.userManagement.deleteUser(claimed.id);
  if (!(await providerAbsent(t, claimed.id))) {
    return { outcome: "pending" };
  }
  await close("provider_deleted");
  return { outcome: "deleted" };
}

export const reserveSignup = internalAction({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const t = await target(ctx);
    const reserved = await ctx.runMutation(
      internal.workosE2eReservations.reserve,
      {
        ...t.pins,
        requestId,
        email: `e2e-signup-${randomBytes(16).toString("hex")}@${t.domain}`,
      }
    );
    if (reserved.kind === "budget") {
      return { status: 429, body: { code: "E2E_RESERVATION_BUDGET" } };
    }
    const { reservation } = reserved;
    const live = reservation.expiresAt > Date.now();
    if (live && reservation.state === "pending") {
      // Absence is checked only after the durable insert. Later evidence must
      // still pass `bind`'s creation-time window (an email change is not new).
      if (await providerUser(t, reservation.email)) {
        return { status: 409, body: { code: "E2E_RESERVATION_CONFLICT" } };
      }
      await t.validate();
      await ctx.runMutation(internal.workosE2eReservations.clear, {
        ...t.pins,
        id: reservation._id,
      });
    } else if (!(live && reservation.state === "reserved")) {
      return { status: 409, body: { code: "E2E_RESERVATION_UNAVAILABLE" } };
    }
    return {
      status: 200,
      body: {
        reservationId: reservation._id,
        email: reservation.email,
        expiresAt: reservation.expiresAt,
      },
    };
  },
});

export const adoptSignup = internalAction({
  args: { reservationId: v.string(), email: v.string() },
  handler: async (ctx, { reservationId, email }) => {
    const t = await target(ctx);
    if (!isE2EEmail(email, t.domain) || email !== email.trim().toLowerCase()) {
      return { status: 400, body: { code: "E2E_RESERVATION_INVALID" } };
    }
    const reservation = await ctx.runQuery(
      internal.workosE2eReservations.byEmail,
      { email }
    );
    // Exact equality with the stored document ID is the ID validation.
    if (
      reservation?._id !== reservationId ||
      reservation.state === "closed" ||
      reservation.expiresAt <= Date.now()
    ) {
      return { status: 409, body: { code: "E2E_RESERVATION_UNAVAILABLE" } };
    }
    const user = await providerUser(t, email);
    if (!user) {
      return { status: 409, body: { code: "E2E_SIGNUP_MISSING" } };
    }
    const claimed = await claim(ctx, t, reservation, user);
    for (let attempt = 0; claimed.emailVerified && attempt < 10; attempt++) {
      await t.validate();
      if (
        await ctx.runMutation(internal.workosE2eReservations.qualify, {
          ...t.pins,
          id: reservation._id,
          workosUserId: claimed.id,
        })
      ) {
        return { status: 200, body: { email } };
      }
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return { status: 503, body: { code: "E2E_ADOPT_PENDING" } };
  },
});

const cursorSchema = z
  .object({
    providerAfter: z.string().max(1024).nullable(),
    providerDone: z.boolean(),
    ownerCursor: z.string().max(4096).nullable(),
    ownerDone: z.boolean(),
    reservationBefore: z.number().int().nonnegative(),
    reservationCursor: z.string().max(4096).nullable(),
    reservationDone: z.boolean(),
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
    const t = await target(ctx);
    const { workos, domain, validate, clientId, environmentId, pins } = t;
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
          // Fixed per sweep: a reservation user is at least the orphan floor old.
          reservationBefore: Date.now() - orphanMinimum - clockSkew,
          reservationCursor: null,
          reservationDone: false,
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
    // `undefined` marks a reservation email whose provider user is looked up
    // inside the per-candidate failure boundary, so one bad lease cannot
    // abort the page for every other candidate.
    const candidates = new Map<string, User | null | undefined>();
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
      if (!progress.reservationDone) {
        const page = await ctx.runQuery(
          internal.workosE2eReservations.expired,
          {
            before: progress.reservationBefore,
            cursor: progress.reservationCursor,
          }
        );
        for (const email of page.emails) {
          if (!candidates.has(email)) {
            candidates.set(email, undefined);
          }
        }
        if (
          !page.done &&
          (!page.cursor || page.cursor === progress.reservationCursor)
        ) {
          throw new Error("E2E reservation cursor cycle");
        }
        progress.reservationCursor = page.cursor;
        progress.reservationDone = page.done;
      }
    }
    let pending = false;
    for (const [email, candidate] of candidates) {
      try {
        let user =
          candidate === undefined ? await providerUser(t, email) : candidate;
        await validate();
        const reservation = await ctx.runQuery(
          internal.workosE2eReservations.byEmail,
          { email }
        );
        if (reservation && reservation.state !== "closed") {
          const settled = await settle(ctx, t, reservation, user);
          if ("outcome" in settled) {
            if (settled.outcome === "deleted") {
              result.deleted.push(email);
            } else {
              pending = true;
              result.failures.push({
                email,
                reason: "account cleanup pending",
              });
            }
            continue;
          }
          user = settled.user;
        }
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
          ...pins,
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
          // A reserved fixture is cleaned only once its exact provider user
          // is gone too; then its lease closes in this same call.
          if (reservation && reservation.state !== "closed") {
            if (!(await providerAbsent(t, user.id))) {
              pending = true;
              result.failures.push({
                email,
                reason: "account cleanup pending",
              });
              continue;
            }
            await ctx.runMutation(internal.workosE2eReservations.close, {
              ...pins,
              id: reservation._id,
              reason: "provider_deleted",
            });
          }
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
      exact ||
      (progress.providerDone && progress.ownerDone && progress.reservationDone)
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
