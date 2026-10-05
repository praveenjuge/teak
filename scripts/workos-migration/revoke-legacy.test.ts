import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./revoke-legacy";

test("operator command defaults to read-only, rejects wrong target and keeps barrier on partial failure", async () => {
  const saved = process.env.WORKOS_API_KEY,
    key = crypto.randomUUID();
  process.env.WORKOS_API_KEY = key;
  const directory = await mkdtemp(join(tmpdir(), "teak-revoke-")),
    path = join(directory, "barrier.held");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      deployment: "isolated-rehearsal",
      environmentId: "environment_test",
      clientId: "client_test",
      holder: crypto.randomUUID(),
      generation: 1,
      apiKeyFingerprint: createHash("sha256").update(key).digest("hex"),
    }),
    { mode: 0o600 }
  );
  const args = ["--receipt", path, "--deployment", "isolated-rehearsal"],
    calls: string[] = [];
  const transport = (name: string) =>
    Promise.resolve().then(() => {
      calls.push(name);
      if (name.endsWith(":revokeLegacyPage")) {
        throw new Error("Provider state uncertain");
      }
      return null;
    });
  try {
    await main(args, transport);
    expect(calls).toEqual(["migration/workosImportLease:verifyQuiescence"]);
    await expect(main([...args, "--apply"], transport)).rejects.toThrow(
      "approval"
    );
    await expect(
      main(
        [
          "--receipt",
          path,
          "--deployment",
          "different-target",
          "--apply",
          "--approval-reference",
          "synthetic-test",
        ],
        transport
      )
    ).rejects.toThrow("pins changed");
    expect(calls).toHaveLength(1);
    await expect(
      main(
        [...args, "--apply", "--approval-reference", "synthetic-test"],
        transport
      )
    ).rejects.toThrow("uncertain");
    expect(await readdir(directory)).toEqual(["barrier.held"]);
    expect(calls.some((name) => name.endsWith(":releaseQuiescence"))).toBe(
      false
    );
  } finally {
    if (saved === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = saved;
    }
  }
});
test("operator command requires empty completion pages for both token models before writing private completion evidence", async () => {
  const saved = process.env.WORKOS_API_KEY,
    key = crypto.randomUUID();
  process.env.WORKOS_API_KEY = key;
  const directory = await mkdtemp(join(tmpdir(), "teak-revoke-complete-")),
    path = join(directory, "barrier.held");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      deployment: "isolated-rehearsal",
      environmentId: "environment_test",
      clientId: "client_test",
      holder: crypto.randomUUID(),
      generation: 2,
      apiKeyFingerprint: createHash("sha256").update(key).digest("hex"),
    }),
    { mode: 0o600 }
  );
  const args = [
    "--receipt",
    path,
    "--deployment",
    "isolated-rehearsal",
    "--apply",
    "--approval-reference",
    "synthetic-test",
  ];
  const seen = new Set<string>(),
    models: string[] = [];
  const transport = (name: string, input: unknown) =>
    Promise.resolve().then(() => {
      if (!name.endsWith(":revokeLegacyPage")) {
        return null;
      }
      const model = (input as { model: string }).model;
      models.push(model);
      if (seen.has(model)) {
        return { deleted: 0, done: true };
      }
      seen.add(model);
      return { deleted: 20, done: false };
    });
  try {
    await main(args, transport);
    expect(models).toEqual([
      "session",
      "session",
      "oauthAccessToken",
      "oauthAccessToken",
    ]);
    expect(
      (await readdir(directory)).filter((name) =>
        name.includes("legacy-revoked")
      )
    ).toHaveLength(1);
    await expect(
      main(args, async (name) =>
        name.endsWith(":revokeLegacyPage") ? { deleted: 20, done: true } : null
      )
    ).rejects.toThrow("Malformed");
    expect(
      (await readdir(directory)).filter((name) =>
        name.includes("legacy-revoked")
      )
    ).toHaveLength(1);
  } finally {
    if (saved === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = saved;
    }
  }
});
