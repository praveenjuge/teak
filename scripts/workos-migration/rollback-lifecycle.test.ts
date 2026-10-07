import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
