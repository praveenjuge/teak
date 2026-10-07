import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "./rollback-lifecycle";

// Operator failure modes: missing independent approvals, malformed page/cursor,
// incomplete lifecycle, wrong credential pins and accidental flip/unpause.
async function fixture() {
  // Owner-only artifacts are retained as repeatable operator-test evidence.
  const folder = await mkdtemp(join(tmpdir(), "teak-rollback-operator-"));
  const receipt = join(folder, "barrier.json"),
    report = join(folder, "report.json");
  await writeFile(
    receipt,
    JSON.stringify({
      version: 1,
      deployment: "isolated-rollback",
      environmentId: "environment_test",
      clientId: "client_test",
      apiKeyFingerprint: createHash("sha256").update("test-key").digest("hex"),
      holder: "11111111-1111-1111-1111-111111111111",
      generation: 1,
      runId: "a".repeat(64),
      approvalReference: "barrier-test",
    }),
    { flag: "wx", mode: 0o600 }
  );
  return {
    report,
    args: [
      "--receipt",
      receipt,
      "--deployment",
      "isolated-rollback",
      "--report",
      report,
    ],
  };
}
const row = {
  teakUserId: "permanent",
  workosUserId: "user_test",
  deniedDeleted: false,
  invalidateLegacyPassword: true,
  markSameEmailVerified: true,
  promoteDeletion: false,
  blockers: [],
};
async function withKey(operation: () => Promise<void>) {
  const previous = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = "test-key";
  try {
    await operation();
  } finally {
    if (previous === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = previous;
    }
  }
}
// A dry run under the same held barrier: the plan an activation approval reviews.
async function reviewedDryRun(
  f: { report: string; args: string[] },
  transport: (name: string, args: unknown) => Promise<unknown> = (name) =>
    Promise.resolve(
      name.endsWith(":page")
        ? { owners: [row], done: true, cursor: null }
        : null
    ) as Promise<unknown>
) {
  const path = join(dirname(f.report), "reviewed-dry-run.json");
  await main([...f.args.slice(0, -1), path], transport);
  return ["--reviewed-dry-run", path];
}
test("operator dry-run produces private evidence without mutation or flag change", async () => {
  await withKey(async () => {
    const f = await fixture(),
      calls: string[] = [];
    await main(f.args, (name) => {
      calls.push(name);
      if (name.endsWith(":page")) {
        return Promise.resolve({ owners: [row], done: true, cursor: null });
      }
      if (name.endsWith(":verifyQuiescence")) {
        return Promise.resolve(null);
      }
      throw new Error("Unexpected mutation");
    });
    expect(calls.some((name) => name.includes("applyPage"))).toBe(false);
    expect(JSON.parse(await readFile(f.report, "utf8"))).toMatchObject({
      mutationExecuted: false,
      primaryChanged: false,
      accountsUnpaused: false,
      runtimeRollbackProven: false,
    });
    expect((await stat(f.report)).mode % 0o100).toBe(0);
  });
});
test("operator requires both policy and activation approvals before any backend call", async () => {
  const f = await fixture();
  let calls = 0;
  await expect(
    main([...f.args, "--apply"], () => {
      calls++;
      return Promise.resolve(null);
    })
  ).rejects.toThrow("Separate named");
  expect(calls).toBe(0);
});
test("operator apply verifies the final lifecycle and leaves primary/barrier unchanged", async () => {
  await withKey(async () => {
    const f = await fixture();
    let applied = false;
    const args = [
      ...f.args,
      ...(await reviewedDryRun(f)),
      "--apply",
      "--password-policy",
      "invalidate-all-mapped-legacy-passwords",
      "--policy-approval-reference",
      "test-policy",
      "--activation-approval-reference",
      "test-activation",
    ];
    await main(args, (name) => {
      if (name.endsWith(":verifyQuiescence")) {
        return Promise.resolve(null);
      }
      if (name.endsWith(":page")) {
        return Promise.resolve({
          owners: [
            {
              ...row,
              invalidateLegacyPassword: !applied,
              markSameEmailVerified: !applied,
            },
          ],
          done: true,
          cursor: null,
        });
      }
      if (name.endsWith(":applyPage")) {
        applied = true;
        return Promise.resolve({
          scanned: 1,
          invalidated: 1,
          verified: 1,
          deletionFences: 0,
          done: true,
          cursor: null,
        });
      }
      throw new Error("Unexpected primary or barrier mutation");
    });
    expect(JSON.parse(await readFile(f.report, "utf8"))).toMatchObject({
      mutationExecuted: true,
      counts: { invalidated: 1 },
      primaryChanged: false,
      barrierHeld: true,
    });
  });
});
test.each(["blocker", "cursor"])(
  "operator stops on %s without writing a completion artifact",
  async (failure) => {
    await withKey(async () => {
      const f = await fixture();
      await expect(
        main(f.args, async (name) =>
          name.endsWith(":verifyQuiescence")
            ? null
            : {
                owners: [
                  {
                    ...row,
                    blockers: failure === "blocker" ? ["email_conflict"] : [],
                  },
                ],
                done: false,
                cursor: null,
              }
        )
      ).rejects.toThrow();
      await expect(stat(f.report)).rejects.toThrow();
    });
  }
);

test("exclusive durable invocation evidence exists before any backend call", async () => {
  await withKey(async () => {
    const f = await fixture();
    await main(f.args, async (name) => {
      const entries = (await readFile(`${f.report}.invocation.jsonl`, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(entries[0]).toMatchObject({
        stage: "admitted",
        apply: false,
        holder: "11111111-1111-1111-1111-111111111111",
        generation: 1,
      });
      if (name.endsWith(":page")) {
        return { owners: [row], done: true, cursor: null };
      }
      return null;
    });
    expect((await stat(`${f.report}.invocation.jsonl`)).mode % 0o100).toBe(0);
  });
});
test("an existing invocation journal denies every backend call", async () => {
  await withKey(async () => {
    const f = await fixture();
    let calls = 0;
    await writeFile(`${f.report}.invocation.jsonl`, "existing", {
      flag: "wx",
      mode: 0o600,
    });
    await expect(
      main(f.args, () => {
        calls++;
        return Promise.resolve(null);
      })
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
test("a lost writer acknowledgment stays uncertain and explicit rerun starts from first page", async () => {
  await withKey(async () => {
    const f = await fixture();
    let applied = false,
      loseAcknowledgment = true;
    const approvals = [
      ...(await reviewedDryRun(f)),
      "--apply",
      "--password-policy",
      "invalidate-all-mapped-legacy-passwords",
      "--policy-approval-reference",
      "test-policy",
      "--activation-approval-reference",
      "test-activation",
    ];
    const transport = (name: string, args: unknown) => {
      if (name.endsWith(":verifyQuiescence")) {
        return Promise.resolve(null);
      }
      if (name.endsWith(":page")) {
        return Promise.resolve({
          owners: [
            {
              ...row,
              invalidateLegacyPassword: !applied,
              markSameEmailVerified: !applied,
            },
          ],
          done: true,
          cursor: null,
        });
      }
      expect(args).toMatchObject({ cursor: null });
      const wasApplied = applied;
      applied = true;
      if (loseAcknowledgment) {
        loseAcknowledgment = false;
        return Promise.reject(new Error("Lost acknowledgment"));
      }
      return Promise.resolve({
        scanned: 1,
        invalidated: wasApplied ? 0 : 1,
        verified: wasApplied ? 0 : 1,
        deletionFences: 0,
        done: true,
        cursor: null,
      });
    };
    await expect(main([...f.args, ...approvals], transport)).rejects.toThrow(
      "Lost acknowledgment"
    );
    const lines = (await readFile(`${f.report}.invocation.jsonl`, "utf8"))
      .trim()
      .split("\n");
    expect(JSON.parse(lines[lines.length - 1])).toMatchObject({
      stage: "dispatching_page",
      cursor: null,
      lastAcknowledgment: null,
    });
    const resumedReport = f.report.replace(
      "report.json",
      "resumed-report.json"
    );
    await main(
      [...f.args.slice(0, -1), resumedReport, ...approvals],
      transport
    );
    expect(JSON.parse(await readFile(resumedReport, "utf8"))).toMatchObject({
      counts: { invalidated: 0, verified: 0 },
      primaryChanged: false,
    });
  });
});

const policy = [
  "--apply",
  "--password-policy",
  "invalidate-all-mapped-legacy-passwords",
  "--policy-approval-reference",
  "test-policy",
  "--activation-approval-reference",
  "test-activation",
];
const digest = (ids: string[]) =>
  createHash("sha256").update(ids.sort().join("\n")).digest("hex");
test("a dry run records the exact owner plan an approval can quote", async () => {
  await withKey(async () => {
    const f = await fixture();
    const [, path] = await reviewedDryRun(f);
    expect(JSON.parse(await readFile(path, "utf8")).plan).toEqual({
      owners: 1,
      mapped: 1,
      mappingSha256: digest(["permanent\tuser_test"]),
      deniedDeleted: { count: 0, sha256: digest([]), teakUserIds: [] },
      invalidate: {
        count: 1,
        sha256: digest(["permanent"]),
        teakUserIds: ["permanent"],
      },
      verify: {
        count: 1,
        sha256: digest(["permanent"]),
        teakUserIds: ["permanent"],
      },
      fences: { count: 0, sha256: digest([]), teakUserIds: [] },
    });
  });
});
test("apply without a reviewed dry run is refused before any backend call", async () => {
  await withKey(async () => {
    const f = await fixture();
    let calls = 0;
    await expect(
      main([...f.args, ...policy], () => {
        calls++;
        return Promise.resolve(null);
      })
    ).rejects.toThrow("reviewed dry-run report");
    expect(calls).toBe(0);
  });
});
test.each([
  ["another barrier generation", { generation: 2 }],
  ["an edited owner list", { listEdited: true }],
  ["an applied report", { mutationExecuted: true }],
])(
  "a reviewed dry run from %s is refused before any backend call",
  async (_label, change) => {
    await withKey(async () => {
      const f = await fixture();
      const [flag, path] = await reviewedDryRun(f);
      const reviewed = JSON.parse(await readFile(path, "utf8"));
      if ("listEdited" in change) {
        reviewed.plan.invalidate.teakUserIds.push("someone-else");
        reviewed.plan.invalidate.count = 2;
      } else {
        Object.assign(reviewed, change);
      }
      const edited = join(dirname(path), "edited-dry-run.json");
      await writeFile(edited, JSON.stringify(reviewed), {
        flag: "wx",
        mode: 0o600,
      });
      let calls = 0;
      await expect(
        main([...f.args, flag, edited, ...policy], () => {
          calls++;
          return Promise.resolve(null);
        })
      ).rejects.toThrow();
      expect(calls).toBe(0);
      await expect(stat(`${f.report}.invocation.jsonl`)).rejects.toThrow();
    });
  }
);
test.each([
  "invalidateLegacyPassword",
  "markSameEmailVerified",
  "promoteDeletion",
])(
  "a fresh %s owner outside the reviewed dry run writes nothing",
  async (field) => {
    await withKey(async () => {
      const f = await fixture();
      const target = deployment({ permanent: {}, late: {} });
      const reviewed = await reviewedDryRun(f, target.transport);
      target.owners.late[field] = true;
      await expect(
        main([...f.args, ...reviewed, ...policy], target.transport)
      ).rejects.toThrow("nothing was written");
      expect(target.writes).toEqual([]);
      // Refused from the start-of-run plan: no page was ever dispatched.
      const journal = await readFile(`${f.report}.invocation.jsonl`, "utf8");
      expect(journal).not.toContain("dispatching_page");
      await expect(stat(f.report)).rejects.toThrow();
    });
  }
);

type Owner = Omit<typeof row, "workosUserId"> & {
  workosUserId: string | null;
};
// A pinned deployment for scope tests: each owner carries the flags the plan
// query reports. The writer applies one page per call, like applyPage, and
// provider events can be injected just before a write or just after one.
function deployment(
  states: Record<string, Partial<Owner>>,
  pageSize = 1,
  events: {
    beforeWrite?: (cursor: string | null) => void;
    afterWrite?: (cursor: string | null) => void;
  } = {}
) {
  const ids = Object.keys(states);
  const owners: Record<string, Owner> = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        ...row,
        teakUserId: id,
        workosUserId: `user_${id}`,
        invalidateLegacyPassword: false,
        markSameEmailVerified: false,
        ...states[id],
      },
    ])
  );
  const writes: string[] = [];
  const page = (cursor: string | null) => {
    const start = Number(cursor ?? 0),
      end = Math.min(start + pageSize, ids.length);
    return {
      ids: ids.slice(start, end),
      next: end < ids.length ? String(end) : null,
    };
  };
  const transport = (name: string, args: unknown) => {
    const cursor = (args as { cursor?: string | null } | null)?.cursor ?? null;
    if (name.endsWith(":page")) {
      const { ids: slice, next } = page(cursor);
      return Promise.resolve({
        owners: slice.map((id) => ({ ...owners[id] })),
        done: next === null,
        cursor: next,
      });
    }
    if (name.endsWith(":applyPage")) {
      events.beforeWrite?.(cursor);
      const { ids: slice, next } = page(cursor);
      const result = {
        scanned: slice.length,
        invalidated: 0,
        verified: 0,
        deletionFences: 0,
        done: next === null,
        cursor: next,
      };
      for (const id of slice) {
        const owner = owners[id];
        if (owner.invalidateLegacyPassword) {
          owner.invalidateLegacyPassword = false;
          result.invalidated++;
          writes.push(`invalidate:${id}`);
        }
        if (owner.markSameEmailVerified) {
          owner.markSameEmailVerified = false;
          result.verified++;
          writes.push(`verify:${id}`);
        }
        if (owner.promoteDeletion) {
          owner.promoteDeletion = false;
          owner.deniedDeleted = true;
          result.deletionFences++;
          writes.push(`fence:${id}`);
        }
      }
      events.afterWrite?.(cursor);
      return Promise.resolve(result);
    }
    return Promise.resolve(null);
  };
  return { ids, owners, writes, transport };
}

test("an owner swapped in on a later page mid-apply is not written", async () => {
  await withKey(async () => {
    const f = await fixture();
    const target = deployment(
      {
        a: { invalidateLegacyPassword: true },
        b: { invalidateLegacyPassword: true },
        c: {},
      },
      1,
      {
        afterWrite: (cursor) => {
          if (cursor === null) {
            // Same total count as reviewed: b drops out and c appears.
            target.owners.b.invalidateLegacyPassword = false;
            target.owners.c.invalidateLegacyPassword = true;
          }
        },
      }
    );
    const reviewed = await reviewedDryRun(f, target.transport);
    await expect(
      main([...f.args, ...reviewed, ...policy], target.transport)
    ).rejects.toThrow("this page was not written");
    expect(target.writes).toEqual(["invalidate:a"]);
    await expect(stat(f.report)).rejects.toThrow();
  });
});
test("a provider deletion landing between a page's preflight and its write stops the run, and a resume refuses it", async () => {
  await withKey(async () => {
    const f = await fixture();
    let deleted = false;
    const target = deployment(
      { a: { invalidateLegacyPassword: true }, b: {} },
      2,
      {
        beforeWrite: () => {
          if (!deleted) {
            deleted = true;
            target.owners.b.promoteDeletion = true;
          }
        },
      }
    );
    const reviewed = await reviewedDryRun(f, target.transport);
    await expect(
      main([...f.args, ...reviewed, ...policy], target.transport)
    ).rejects.toThrow("differs from its preflight");
    expect(target.writes).toEqual(["invalidate:a", "fence:b"]);
    const lines = (await readFile(`${f.report}.invocation.jsonl`, "utf8"))
      .trim()
      .split("\n");
    expect(JSON.parse(lines[lines.length - 1])).toMatchObject({
      stage: "page_acknowledged",
      lastAcknowledgment: { result: { deletionFences: 1 } },
    });
    const resumed = join(dirname(f.report), "resumed-report.json");
    await expect(
      main(
        [...f.args.slice(0, -1), resumed, ...reviewed, ...policy],
        target.transport
      )
    ).rejects.toThrow("nothing was written");
    await expect(stat(resumed)).rejects.toThrow();
  });
});
test.each(["invalidateLegacyPassword", "markSameEmailVerified"] as const)(
  "an owner newly selected for %s between a page's preflight and its write stops the run",
  async (field) => {
    await withKey(async () => {
      const f = await fixture();
      let changed = false;
      const target = deployment({ a: {}, b: {} }, 2, {
        beforeWrite: () => {
          if (!changed) {
            changed = true;
            target.owners.b[field] = true;
          }
        },
      });
      const reviewed = await reviewedDryRun(f, target.transport);
      await expect(
        main([...f.args, ...reviewed, ...policy], target.transport)
      ).rejects.toThrow("differs from its preflight");
      await expect(stat(f.report)).rejects.toThrow();
    });
  }
);
test("a page that gains an owner row between its preflight and its write stops the run", async () => {
  await withKey(async () => {
    const f = await fixture();
    let inserted = false;
    const target = deployment(
      { a: { invalidateLegacyPassword: true }, b: {} },
      3,
      {
        beforeWrite: () => {
          if (!inserted) {
            inserted = true;
            // An unmapped, undeleted row: no flag, link or tombstone changes.
            target.ids.splice(1, 0, "a2");
            target.owners.a2 = {
              ...target.owners.b,
              teakUserId: "a2",
              workosUserId: null,
            };
          }
        },
      }
    );
    const reviewed = await reviewedDryRun(f, target.transport);
    await expect(
      main([...f.args, ...reviewed, ...policy], target.transport)
    ).rejects.toThrow("differs from its preflight");
    await expect(stat(f.report)).rejects.toThrow();
  });
});
test("an owner relinked to another provider user during apply stops the run", async () => {
  await withKey(async () => {
    const f = await fixture();
    const target = deployment(
      { a: { invalidateLegacyPassword: true }, b: {} },
      1,
      {
        afterWrite: (cursor) => {
          if (cursor === null) {
            target.owners.b.workosUserId = "user_other";
          }
        },
      }
    );
    const reviewed = await reviewedDryRun(f, target.transport);
    await expect(
      main([...f.args, ...reviewed, ...policy], target.transport)
    ).rejects.toThrow("changed outside the reviewed dry run");
    await expect(stat(f.report)).rejects.toThrow();
  });
});
test("a reviewed scope applies exactly and a lost acknowledgment resumes to the same result", async () => {
  await withKey(async () => {
    const f = await fixture();
    let lose = true;
    const target = deployment(
      {
        a: { invalidateLegacyPassword: true, markSameEmailVerified: true },
        b: { promoteDeletion: true },
        c: { deniedDeleted: true, workosUserId: null },
      },
      1
    );
    const reviewed = await reviewedDryRun(f, target.transport);
    const losing = (name: string, args: unknown) =>
      target.transport(name, args).then((result) => {
        if (name.endsWith(":applyPage") && lose) {
          lose = false;
          throw new Error("Lost acknowledgment");
        }
        return result;
      });
    await expect(
      main([...f.args, ...reviewed, ...policy], losing)
    ).rejects.toThrow("Lost acknowledgment");
    const resumed = join(dirname(f.report), "resumed-report.json");
    await main(
      [...f.args.slice(0, -1), resumed, ...reviewed, ...policy],
      losing
    );
    expect(target.writes).toEqual(["invalidate:a", "verify:a", "fence:b"]);
    expect(JSON.parse(await readFile(resumed, "utf8"))).toMatchObject({
      mutationExecuted: true,
      counts: { scanned: 3, invalidated: 0, verified: 0, deletionFences: 1 },
    });
  });
});
