import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./quiesce-importer";

test("barrier command defaults to read-only and requires separate approval before mutation", async () => {
  const saved = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = crypto.randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "teak-import-barrier-")),
    path = join(directory, "barrier.json");
  const args = [
    "--deployment",
    "isolated-rehearsal",
    "--environment-id",
    "environment_test",
    "--client-id",
    "client_test",
    "--operation",
    "establish",
    "--receipt",
    path,
  ];
  const calls: string[] = [];
  const transport = (name: string) =>
    Promise.resolve().then(() => {
      calls.push(name);
      return {
        ready: true,
        barrierHeld: false,
        pendingRemote: false,
        generation: null,
      };
    });
  try {
    await main(args, transport);
    expect(calls).toEqual(["migration/workosImportLease:quiescence"]);
    await expect(stat(path)).rejects.toThrow();
    await expect(main([...args, "--apply"], transport)).rejects.toThrow(
      "approval"
    );
    expect(calls).toHaveLength(1);
  } finally {
    if (saved === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = saved;
    }
  }
});
test("lost barrier response preserves private holder receipt, retries idempotently and verifies before release", async () => {
  const saved = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = crypto.randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "teak-import-barrier-retry-")),
    path = join(directory, "barrier.json");
  const pins = [
    "--deployment",
    "isolated-rehearsal",
    "--environment-id",
    "environment_test",
    "--client-id",
    "client_test",
  ];
  const establish = [
    ...pins,
    "--operation",
    "establish",
    "--receipt",
    path,
    "--apply",
    "--approval-reference",
    "synthetic-test-approval",
  ];
  let holder: string | null = null,
    lost = true;
  const calls: string[] = [];
  const transport = (name: string, args: unknown) =>
    Promise.resolve().then(() => {
      calls.push(name);
      const request = args as { holder: string; generation?: number };
      if (name.endsWith(":establishQuiescence")) {
        if (holder === null) {
          holder = request.holder;
        }
        expect(request.holder).toBe(holder);
        if (lost) {
          lost = false;
          throw new Error("Response lost after durable barrier creation");
        }
        return { holder, generation: 3 };
      }
      expect(request.holder).toBe(holder);
      expect(request.generation).toBe(3);
      return null;
    });
  try {
    await expect(main(establish, transport)).rejects.toThrow("Response lost");
    expect((await stat(path)).mode % 0o100).toBe(0);
    const original = await readFile(path, "utf8");
    await main(establish, transport);
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await stat(`${path}.held`)).mode % 0o100).toBe(0);
    await main(establish, transport);
    await main(
      [...pins, "--operation", "verify", "--receipt", `${path}.held`],
      transport
    );
    await main(
      [
        ...pins,
        "--operation",
        "release",
        "--receipt",
        `${path}.held`,
        "--apply",
        "--approval-reference",
        "synthetic-release-approval",
      ],
      transport
    );
    expect(calls.slice(-2)).toEqual([
      "migration/workosImportLease:verifyQuiescence",
      "migration/workosImportLease:releaseQuiescence",
    ]);
    const count = calls.length;
    process.env.WORKOS_API_KEY = crypto.randomUUID();
    await expect(
      main(
        [...pins, "--operation", "verify", "--receipt", `${path}.held`],
        transport
      )
    ).rejects.toThrow("pins changed");
    expect(calls).toHaveLength(count);
  } finally {
    if (saved === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = saved;
    }
  }
});
