import { expect, test } from "bun:test";
import {
  type ImportedUser,
  type ImportOwner,
  type ImportPorts,
  importOwners,
} from "./import-engine";

const owner: ImportOwner = {
  sourceVersion: "test-source-version",
  teakUserId: "permanent_owner",
  email: "owner@example.com",
  emailVerified: false,
  name: "Owner",
  passwordHash: null,
  changedAt: 1,
  deletedAt: null,
  workosUserId: null,
};
const options = {
  dryRun: false,
  mutationApproved: true,
  hashesProven: false,
  delta: false,
  changedSince: 0,
  cursor: null,
  startedAt: 2,
};
test("erased deleted owners absent at the provider are skipped without recreation", async () => {
  const f = fixture();
  f.ports.source = async () => ({
    owners: [{ ...owner, email: "", deletedAt: 5 }],
    done: true,
    cursor: null,
    unresolvedQuarantine: false,
  });
  const report = await importOwners(f.ports, options);
  expect(report.scanned).toBe(1);
  expect(f.users.size).toBe(0);
  expect(f.mappings.size).toBe(0);
});
test.each([false, true])(
  "erased tombstones cannot delete an unproven provider address in delta=%s",
  async (delta) => {
    const f = fixture();
    f.ports.source = async () => ({
      owners: [{ ...owner, email: "", deletedAt: 5 }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
    f.users.set(owner.teakUserId, {
      id: "user_retained",
      externalId: owner.teakUserId,
      email: owner.email,
      emailVerified: true,
    });
    await expect(
      importOwners(f.ports, { ...options, delta })
    ).rejects.toThrow();
    expect(f.users.size).toBe(1);
    expect(f.mappings.size).toBe(0);
  }
);
test.each([
  { email: "", deletedAt: null },
  { email: "malformed", deletedAt: null },
  { email: "malformed", deletedAt: 5 },
  { email: "", deletedAt: Number.NaN },
])(
  "invalid source addresses fail before provider access: %j",
  async (input) => {
    const f = fixture();
    let providerReads = 0;
    f.ports.source = async () => ({
      owners: [{ ...owner, ...input }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
    f.ports.lookup = () => {
      providerReads++;
      return Promise.resolve(null);
    };
    await expect(importOwners(f.ports, options)).rejects.toThrow();
    expect(providerReads).toBe(0);
    expect(f.users.size).toBe(0);
    expect(f.mappings.size).toBe(0);
  }
);
function fixture() {
  const users = new Map<string, ImportedUser>(),
    mappings = new Map<string, string>(),
    delays: number[] = [];
  let checkpoints = 0,
    failLink = false,
    createFailures = 0,
    quarantine = false;
  const ports: ImportPorts = {
    quarantine: () => Promise.resolve(),
    source: () =>
      Promise.resolve({
        owners: [owner],
        done: true,
        cursor: null,
        unresolvedQuarantine: quarantine,
      }),
    lookup: (id) => Promise.resolve(users.get(id) ?? null),
    create: (input) => {
      if (createFailures > 0) {
        createFailures--;
        return Promise.reject({ status: 429, retryAfter: 2 });
      }
      const user = {
        id: "user_created",
        externalId: input.teakUserId,
        email: input.email,
        emailVerified: input.emailVerified,
      };
      users.set(input.teakUserId, user);
      return Promise.resolve(user);
    },
    update: (user, input) => {
      const next = {
        ...user,
        email: input.email,
        emailVerified: input.emailVerified,
      };
      users.set(input.teakUserId, next);
      return Promise.resolve(next);
    },
    remove: (user) => {
      if (user.externalId) {
        users.delete(user.externalId);
      }
      return Promise.resolve();
    },
    link: (input, user) => {
      if (failLink) {
        return Promise.reject(new Error("Crash before mapping"));
      }
      mappings.set(input.teakUserId, user.id);
      return Promise.resolve("linked");
    },
    checkpoint: () => {
      checkpoints++;
      return Promise.resolve();
    },
    sleep: (delay) => {
      delays.push(delay);
      return Promise.resolve();
    },
  };
  return {
    ports,
    users,
    mappings,
    delays,
    checkpoints: () => checkpoints,
    failLink: () => {
      failLink = true;
    },
    recover: () => {
      failLink = false;
    },
    rateLimit: () => {
      createFailures = 3;
    },
    quarantine: () => {
      quarantine = true;
    },
  };
}
// Failure modes: created user before local mapping crashes; repeat imports;
// provider rate-limit storm; quarantine; dry-run mutation; external-id/email
// collision; delta verification and deletion; non-progressing pages.
test("crash after provider creation resumes one permanent mapping without creating twice", async () => {
  const f = fixture();
  f.failLink();
  await expect(importOwners(f.ports, options)).rejects.toThrow(
    "Crash before mapping"
  );
  expect(f.users.size).toBe(1);
  expect(f.mappings.size).toBe(0);
  expect(f.checkpoints()).toBe(0);
  f.recover();
  await importOwners(f.ports, options);
  await importOwners(f.ports, options);
  expect([...f.mappings.entries()]).toEqual([
    [owner.teakUserId, "user_created"],
  ]);
  expect(f.users.size).toBe(1);
});
test("dry-run and unapproved execution create no provider or local state", async () => {
  const f = fixture();
  expect(
    await importOwners(f.ports, {
      ...options,
      dryRun: true,
      mutationApproved: false,
    })
  ).toMatchObject({ created: 1, dryRun: true });
  await expect(
    importOwners(f.ports, { ...options, mutationApproved: false })
  ).rejects.toThrow("separate approval");
  expect(f.users.size).toBe(0);
  expect(f.mappings.size).toBe(0);
  expect(f.checkpoints()).toBe(0);
});
test("rate limits honor Retry-After and preserve the same owner before mapping", async () => {
  const f = fixture();
  f.rateLimit();
  await importOwners(f.ports, options);
  expect(f.delays).toEqual([2000, 2000, 4000]);
  expect(f.users.size).toBe(1);
  expect(f.mappings.get(owner.teakUserId)).toBe("user_created");
});
test("quarantine and external-id email collisions halt without mapping or checkpoint", async () => {
  const f = fixture();
  f.quarantine();
  await expect(importOwners(f.ports, options)).rejects.toThrow("quarantine");
  expect(f.users.size).toBe(0);
  const conflict = fixture();
  conflict.users.set(owner.teakUserId, {
    id: "user_existing",
    externalId: owner.teakUserId,
    email: "another@example.com",
    emailVerified: true,
  });
  await expect(importOwners(conflict.ports, options)).rejects.toThrow(
    "email conflict"
  );
  expect(conflict.mappings.size).toBe(0);
  expect(conflict.checkpoints()).toBe(0);
});
test("delta resync preserves exact verification and deletion does not recreate a provider", async () => {
  const f = fixture();
  await importOwners(f.ports, options);
  f.ports.source = () =>
    Promise.resolve({
      owners: [{ ...owner, emailVerified: true, changedAt: 4 }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
  await importOwners(f.ports, {
    ...options,
    delta: true,
    changedSince: 3,
    startedAt: 4,
  });
  expect(f.users.get(owner.teakUserId)?.emailVerified).toBe(true);
  f.ports.source = () =>
    Promise.resolve({
      owners: [{ ...owner, deletedAt: 5, changedAt: 5 }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
  await importOwners(f.ports, {
    ...options,
    delta: true,
    changedSince: 4,
    startedAt: 6,
  });
  expect(f.users.size).toBe(0);
});

test("provider create conflicts persist quarantine and cannot advance mapping or journal", async () => {
  const f = fixture();
  const receipts: string[] = [];
  f.ports.create = () => Promise.reject({ status: 409 });
  f.ports.quarantine = (_owner, _user, reason) => {
    receipts.push(reason);
    return Promise.resolve();
  };
  await expect(importOwners(f.ports, options)).rejects.toMatchObject({
    status: 409,
  });
  expect(receipts).toEqual(["link_conflict"]);
  expect(f.mappings.size).toBe(0);
  expect(f.checkpoints()).toBe(0);
});

test("a provider verification override is quarantined before linking", async () => {
  const f = fixture();
  const receipts: string[] = [];
  f.ports.create = (input) =>
    Promise.resolve({
      id: "user_override",
      externalId: input.teakUserId,
      email: input.email,
      emailVerified: true,
    });
  f.ports.quarantine = (_owner, _user, reason) => {
    receipts.push(reason);
    return Promise.resolve();
  };
  await expect(importOwners(f.ports, options)).rejects.toThrow(
    "verification did not match"
  );
  expect(receipts).toEqual(["link_conflict"]);
  expect(f.mappings.size).toBe(0);
  expect(f.checkpoints()).toBe(0);
});

test("unproven changed passwords cannot retain a stale provider credential during delta", async () => {
  const f = fixture();
  await importOwners(f.ports, options);
  f.ports.source = () =>
    Promise.resolve({
      owners: [{ ...owner, passwordHash: "unsupported-hash", changedAt: 4 }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
  await expect(
    importOwners(f.ports, {
      ...options,
      delta: true,
      changedSince: 3,
      startedAt: 4,
    })
  ).rejects.toThrow("Changed credential cannot be imported");
  expect(f.checkpoints()).toBe(1);
  expect(f.users.get(owner.teakUserId)?.emailVerified).toBe(false);
});

test("initial resume updates a changed proven password and denies an unproven stale credential", async () => {
  const f = fixture();
  await importOwners(f.ports, options);
  const passwordHash = `${"a".repeat(32)}:${"b".repeat(128)}`;
  f.ports.source = () =>
    Promise.resolve({
      owners: [{ ...owner, passwordHash, changedAt: 4 }],
      done: true,
      cursor: null,
      unresolvedQuarantine: false,
    });
  let updatedHash: string | null = null;
  const update = f.ports.update;
  f.ports.update = (user, source, hash) => {
    updatedHash = hash;
    return update(user, source, hash);
  };
  await importOwners(f.ports, { ...options, hashesProven: true, startedAt: 5 });
  expect(updatedHash).not.toBeNull();
  expect(f.checkpoints()).toBe(2);
  await expect(
    importOwners(f.ports, { ...options, startedAt: 5 })
  ).rejects.toThrow("Resumed credential cannot be proven");
  expect(f.checkpoints()).toBe(2);
});
