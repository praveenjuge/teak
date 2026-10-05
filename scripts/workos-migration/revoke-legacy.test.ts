import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
      if (name.endsWith(":revokeNativeCodesPage")) {
        if (seen.has("native")) {
          return { deleted: 0, done: true };
        }
        seen.add("native");
        return { deleted: 2, done: false };
      }
      if (name.endsWith(":revokePendingGrantsPage")) {
        if (seen.has("grant")) {
          return {
            deleted: 3,
            scanned: 3,
            done: true,
            cursor: null,
            blockedIds: [],
          };
        }
        seen.add("grant");
        return {
          deleted: 12,
          scanned: 20,
          done: false,
          cursor: "next-grants",
          blockedIds: [],
        };
      }
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
    const artifact = (await readdir(directory)).find((name) =>
      name.includes("legacy-revoked")
    );
    if (!artifact) {
      throw new Error("Missing completion artifact");
    }
    expect(
      JSON.parse(await readFile(join(directory, artifact), "utf8")).counts
    ).toEqual({
      session: 20,
      oauthAccessToken: 20,
      nativeAuthCodes: 2,
      pendingGrants: 15,
    });
    expect((await stat(join(directory, artifact))).mode % 0o1000).toBe(0o600);
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

test.each(["ambiguous", "stalled", "bad-native"])(
  "operator retains barrier and never writes completion for %s pending grant failure",
  async (failure) => {
    const saved = process.env.WORKOS_API_KEY;
    const key = crypto.randomUUID();
    process.env.WORKOS_API_KEY = key;
    const directory = await mkdtemp(join(tmpdir(), "teak-revoke-blocked-"));
    const path = join(directory, "barrier.held");
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
    const calls: string[] = [];
    const transport = (name: string) =>
      Promise.resolve().then(() => {
        calls.push(name);
        if (name.endsWith(":revokeLegacyPage")) {
          return { deleted: 0, done: true };
        }
        if (name.endsWith(":revokeNativeCodesPage")) {
          return failure === "bad-native"
            ? { deleted: 1, done: true }
            : { deleted: 0, done: true };
        }
        if (name.endsWith(":revokePendingGrantsPage")) {
          return failure === "ambiguous"
            ? {
                deleted: 0,
                scanned: 1,
                done: true,
                cursor: null,
                blockedIds: ["row_id_only"],
              }
            : {
                deleted: 0,
                scanned: 1,
                done: false,
                cursor: "same-cursor",
                blockedIds: [],
              };
        }
        return null;
      });
    try {
      await expect(
        main(
          [
            "--receipt",
            path,
            "--deployment",
            "isolated-rehearsal",
            "--apply",
            "--approval-reference",
            "synthetic-test",
          ],
          transport
        )
      ).rejects.toThrow();
      const artifacts = await readdir(directory);
      expect(artifacts.some((name) => name.includes("legacy-revoked"))).toBe(
        false
      );
      expect(
        artifacts.filter((name) => name.includes("legacy-grants-blocked"))
      ).toHaveLength(failure === "ambiguous" ? 1 : 0);
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
  }
);
