import type { MutationCtx } from "../_generated/server";
import { readAccountChangesPaused, readAuthPrimary } from "../env";
import { classifyLegacyGrant } from "./workosLegacyGrants";

// Called from component triggers in the credential write transaction, so a
// write admitted before the switch to WorkOS still rolls back afterward.
export function assertLegacyCredentialWrite(_ctx: MutationCtx): Promise<void> {
  if (readAuthPrimary() !== "betterauth") {
    return Promise.reject(
      new Error("Legacy credential writes are stopped for the auth transition")
    );
  }
  return Promise.resolve();
}

export async function assertLegacyAccountWrite(ctx: MutationCtx) {
  if (readAccountChangesPaused()) {
    throw new Error(
      "Legacy account changes are paused for the auth transition"
    );
  }
  await assertLegacyCredentialWrite(ctx);
}

export async function assertLegacyProtectedProfileWrite(
  ctx: MutationCtx,
  next: { email: string; emailVerified: boolean },
  previous: { email: string; emailVerified: boolean }
) {
  // Login timestamps/name/avatar refreshes remain valid in Better Auth during
  // the pause; only account authority changes require the transactional fence.
  if (
    next.email !== previous.email ||
    next.emailVerified !== previous.emailVerified
  ) {
    await assertLegacyAccountWrite(ctx);
  }
}

interface LegacyAccountAuthority {
  accountId: string;
  password?: string | null;
  providerId: string;
  userId: string;
}
export async function assertLegacyAccountUpdate(
  ctx: MutationCtx,
  next: LegacyAccountAuthority,
  previous: LegacyAccountAuthority
) {
  // Existing social sign-in rotates provider credentials while account changes
  // are paused. Only identity/password changes are frozen before the barrier.
  await assertLegacyCredentialWrite(ctx);
  if (
    readAccountChangesPaused() &&
    (next.password !== previous.password ||
      next.providerId !== previous.providerId ||
      next.accountId !== previous.accountId ||
      next.userId !== previous.userId)
  ) {
    throw new Error(
      "Legacy account changes are paused for the auth transition"
    );
  }
}

export async function assertLegacyVerificationWrite(
  ctx: MutationCtx,
  next: { identifier: string; value: string },
  previous?: { identifier: string; value: string }
) {
  const classifications = [
    classifyLegacyGrant(next),
    ...(previous ? [classifyLegacyGrant(previous)] : []),
  ];
  if (classifications.includes("ambiguous")) {
    throw new Error("Ambiguous legacy grant requires operator review");
  }
  if (classifications.includes("grant")) {
    await assertLegacyCredentialWrite(ctx);
  }
}
