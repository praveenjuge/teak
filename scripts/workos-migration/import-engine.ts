import { toWorkosPasswordHash } from "../../packages/convex/migration/passwordHash";

export interface ImportOwner {
  changedAt: number;
  deletedAt: number | null;
  email: string;
  emailVerified: boolean;
  name: string | null;
  passwordHash: string | null;
  sourceVersion: string;
  teakUserId: string;
  workosUserId: string | null;
}
export interface ImportedUser {
  email: string;
  emailVerified: boolean;
  externalId: string | null;
  id: string;
}
export interface ImportPorts {
  checkpoint: (
    cursor: string | null,
    complete: boolean,
    watermark: number
  ) => Promise<void>;
  create: (
    owner: ImportOwner,
    passwordHash: string | null
  ) => Promise<ImportedUser>;
  link: (
    owner: ImportOwner,
    user: ImportedUser
  ) => Promise<"linked" | "quarantined">;
  lookup: (externalId: string) => Promise<ImportedUser | null>;
  quarantine: (
    owner: ImportOwner,
    user: ImportedUser | null,
    reason:
      | "external_id_mismatch"
      | "link_conflict"
      | "duplicate_email"
      | "missing_mapping"
  ) => Promise<void>;
  remove: (user: ImportedUser, owner: ImportOwner) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  source: (cursor: string | null) => Promise<{
    owners: ImportOwner[];
    done: boolean;
    cursor: string | null;
    unresolvedQuarantine: boolean;
  }>;
  update: (
    user: ImportedUser,
    owner: ImportOwner,
    passwordHash: string | null
  ) => Promise<ImportedUser>;
}
export interface ImportOptions {
  changedSince: number;
  cursor: string | null;
  delta: boolean;
  dryRun: boolean;
  hashesProven: boolean;
  mutationApproved: boolean;
  startedAt: number;
}
export interface ImportReport {
  created: number;
  deleted: number;
  dryRun: boolean;
  needsPasswordReset: number;
  resumed: number;
  scanned: number;
  updated: number;
}
const email = (value: string) => value.trim().toLowerCase();
async function retry<T>(
  ports: ImportPorts,
  operation: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : undefined;
      if (
        attempt >= 5 ||
        (status !== 429 && !(status !== undefined && status >= 500))
      ) {
        throw error;
      }
      const retryAfter =
        typeof error === "object" && error !== null && "retryAfter" in error
          ? Number(error.retryAfter)
          : 0;
      // A provider wait longer than this process's budget is an operator retry,
      // not permission to send another request before Retry-After expires.
      if (retryAfter > 3600) {
        throw error;
      }
      await ports.sleep(
        Math.max(
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
          1000 * 2 ** attempt
        )
      );
    }
  }
}
function assertOwner(owner: ImportOwner) {
  const address = email(owner.email);
  if (
    !(
      owner.teakUserId &&
      (/^[^\s@]+@[^\s@]+$/.test(address) ||
        (owner.deletedAt !== null &&
          Number.isFinite(owner.deletedAt) &&
          address === ""))
    ) ||
    typeof owner.emailVerified !== "boolean" ||
    !Number.isFinite(owner.changedAt)
  ) {
    throw new Error("Invalid migration source; no defaults allowed");
  }
}
function assertProvider(
  owner: ImportOwner,
  user: ImportedUser,
  delta: boolean
) {
  if (
    !user.id.startsWith("user_") ||
    user.externalId !== owner.teakUserId ||
    (owner.workosUserId !== null && owner.workosUserId !== user.id)
  ) {
    throw new Error("Provider mapping conflict; quarantine before continuing");
  }
  if (
    email(owner.email) === "" ||
    (!delta && email(user.email) !== email(owner.email))
  ) {
    throw new Error("External ID email conflict; quarantine before continuing");
  }
}
async function validateRemote(
  ports: ImportPorts,
  owner: ImportOwner,
  user: ImportedUser,
  options: ImportOptions,
  exactVerification = false
) {
  try {
    assertProvider(owner, user, options.delta && !exactVerification);
    if (exactVerification && user.emailVerified !== owner.emailVerified) {
      throw new Error("Provider verification did not match explicit source");
    }
  } catch (error) {
    if (!options.dryRun) {
      let reason: "external_id_mismatch" | "link_conflict" | "duplicate_email" =
        "duplicate_email";
      if (user.externalId !== owner.teakUserId) {
        reason = "external_id_mismatch";
      } else if (
        (owner.workosUserId && owner.workosUserId !== user.id) ||
        (exactVerification && user.emailVerified !== owner.emailVerified)
      ) {
        reason = "link_conflict";
      }
      await ports.quarantine(owner, user, reason);
    }
    throw error;
  }
}
export async function importOwners(
  ports: ImportPorts,
  options: ImportOptions
): Promise<ImportReport> {
  if (!(options.dryRun || options.mutationApproved)) {
    throw new Error("Import mutations require separate approval");
  }
  if (
    !(
      Number.isFinite(options.startedAt) &&
      Number.isFinite(options.changedSince)
    ) ||
    options.changedSince < 0 ||
    options.changedSince > options.startedAt ||
    options.startedAt > Date.now()
  ) {
    throw new Error("Invalid import watermark");
  }
  const report: ImportReport = {
    scanned: 0,
    created: 0,
    resumed: 0,
    updated: 0,
    deleted: 0,
    needsPasswordReset: 0,
    dryRun: options.dryRun,
  };
  let cursor = options.cursor;
  const seenCursors = new Set<string>();
  while (true) {
    const page = await ports.source(cursor);
    if (page.unresolvedQuarantine) {
      throw new Error("Unresolved quarantine blocks import");
    }
    if (
      page.owners.length > 20 ||
      (!page.done &&
        (!page.cursor ||
          page.cursor === cursor ||
          seenCursors.has(page.cursor)))
    ) {
      throw new Error("Invalid or non-progressing import page");
    }
    for (const owner of page.owners) {
      assertOwner(owner);
      report.scanned++;
      if (options.delta && owner.changedAt < options.changedSince) {
        continue;
      }
      const hash =
        options.hashesProven && owner.passwordHash
          ? toWorkosPasswordHash(owner.passwordHash)
          : null;
      if (
        options.delta &&
        owner.deletedAt === null &&
        owner.passwordHash &&
        !hash &&
        !options.dryRun
      ) {
        throw new Error(
          "Changed credential cannot be imported; password reset must be prepared before delta resumes"
        );
      }
      if (owner.passwordHash && !hash) {
        report.needsPasswordReset++;
      }
      let user = await retry(ports, () => ports.lookup(owner.teakUserId));
      if (user) {
        await validateRemote(ports, owner, user, options);
      }
      if (owner.deletedAt !== null) {
        if (user) {
          if (!options.dryRun) {
            const deletedUser = user;
            await retry(ports, () => ports.remove(deletedUser, owner));
          }
          report.deleted++;
        }
        continue;
      }
      if (user) {
        if (owner.passwordHash && !hash && !options.dryRun) {
          throw new Error(
            "Resumed credential cannot be proven; password reset must be prepared before import resumes"
          );
        }
        report.resumed++;
        // Source credentials may change after a provider create but before a
        // crash/CAS failure. Replaying the current proven hash prevents linking
        // that owner while leaving the provider's earlier password active.
        if (
          options.delta ||
          hash !== null ||
          user.emailVerified !== owner.emailVerified
        ) {
          report.updated++;
          if (!options.dryRun) {
            const existingUser = user;
            user = await retry(ports, () =>
              ports.update(existingUser, owner, hash)
            );
            await validateRemote(ports, owner, user, options, true);
          }
        }
      } else {
        if (owner.workosUserId !== null) {
          if (!options.dryRun) {
            await ports.quarantine(owner, null, "missing_mapping");
          }
          throw new Error(
            "Pinned provider missing; quarantine before continuing"
          );
        }
        report.created++;
        if (options.dryRun) {
          continue;
        }
        try {
          user = await retry(
            ports,
            async () =>
              (await ports.lookup(owner.teakUserId)) ??
              (await ports.create(owner, hash))
          );
        } catch (error) {
          // Conflict/validation errors require an operator decision. Persist a
          // receipt without assuming the provider's message proves an email collision.
          const status =
            typeof error === "object" && error !== null && "status" in error
              ? Number(error.status)
              : undefined;
          if (status === 409 || status === 422) {
            await ports.quarantine(owner, null, "link_conflict");
          }
          throw error;
        }
        await validateRemote(ports, owner, user, options, true);
      }
      if (!options.dryRun && (await ports.link(owner, user)) !== "linked") {
        throw new Error("Mapping quarantined; import halted");
      }
    }
    if (!options.dryRun) {
      await ports.checkpoint(page.cursor, page.done, options.startedAt);
    }
    if (page.done) {
      return report;
    }
    if (!page.cursor) {
      throw new Error("Missing import cursor");
    }
    cursor = page.cursor;
    seenCursors.add(cursor);
  }
}
