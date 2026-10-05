import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admission, readJournal, writeJournal } from "./import-journal";
import { main } from "./import-users";

test("CLI admission, real SDK parsing and filesystem resume recover a first-page crash after create", async () => {
  const directory = await mkdtemp(join(tmpdir(), "teak-import-cli-")),
    journal = join(directory, "journal.json");
  const key = "test-cli-import-transport-key",
    savedKey = process.env.WORKOS_API_KEY,
    savedFetch = globalThis.fetch;
  const pins = {
    deployment: "isolated-rehearsal",
    environmentId: "environment_test",
    clientId: "client_test",
    apiKeyFingerprint: createHash("sha256").update(key).digest("hex"),
    hashesProven: false,
    witnessUserId: "user_witness",
    witnessEmail: "witness@example.com",
    witnessExternalId: null,
  };
  const argv = [
    "--deployment",
    pins.deployment,
    "--environment-id",
    pins.environmentId,
    "--client-id",
    pins.clientId,
    "--witness-email",
    pins.witnessEmail,
    "--witness-external-id",
    "none",
    "--journal",
    journal,
    "--apply",
    "--approval-reference",
    "synthetic-test-approval",
  ];
  let provider: Record<string, unknown> | null = null,
    crash = true,
    mapped = false;
  process.env.WORKOS_API_KEY = key;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input))
        .pathname;
      if (path === "/user_management/users/user_witness") {
        return Response.json({
          object: "user",
          id: pins.witnessUserId,
          email: pins.witnessEmail,
          email_verified: true,
          external_id: null,
          first_name: null,
          last_name: null,
          profile_picture_url: null,
          locale: null,
          metadata: {},
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
          last_sign_in_at: null,
        });
      }
      if (
        path === "/user_management/users" &&
        (init?.method ?? (input instanceof Request ? input.method : "GET")) ===
          "GET"
      ) {
        return Response.json({
          object: "list",
          data: provider ? [provider] : [],
          list_metadata: { before: null, after: null },
        });
      }
      // Journal admission precedes all provider creation and page linking.
      expect((await readJournal(journal, pins)).completed).toBe(false);
      if (path === "/user_management/users/external_id/permanent_owner") {
        return provider
          ? Response.json(provider)
          : Response.json({ message: "Not found" }, { status: 404 });
      }
      if (path === "/user_management/users") {
        if (provider) {
          throw new Error("Duplicate provider creation");
        }
        provider = {
          object: "user",
          id: "user_cliintegration",
          email: "owner@example.com",
          email_verified: false,
          external_id: "permanent_owner",
          name: "Owner",
          first_name: null,
          last_name: null,
          profile_picture_url: null,
          locale: null,
          metadata: {},
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
          last_sign_in_at: null,
        };
        return Response.json(provider);
      }
      throw new Error(`Unexpected mocked provider endpoint ${path}`);
    },
    { preconnect: () => undefined }
  );
  const transport = (name: string, args: unknown) =>
    Promise.resolve().then(() => {
      if (name.endsWith(":acquire")) {
        return { holder: (args as { holder: string }).holder, generation: 1 };
      }
      if (name.startsWith("migration/workosImportLease:")) {
        return null;
      }
      if (name.endsWith(":admission")) {
        return { witnessUserId: pins.witnessUserId };
      }
      if (name.endsWith(":preflightPage")) {
        return {
          owners: [
            {
              teakUserId: "permanent_owner",
              email: "owner@example.com",
              workosUserId: null,
              deleted: false,
              passwordFormat: "none",
            },
          ],
          done: true,
          cursor: null,
        };
      }
      if (name.endsWith(":page")) {
        return {
          owners: [
            {
              teakUserId: "permanent_owner",
              email: "owner@example.com",
              emailVerified: false,
              name: "Owner",
              passwordHash: null,
              changedAt: 1,
              deletedAt: null,
              workosUserId: null,
              sourceVersion: "synthetic-version",
            },
          ],
          done: true,
          cursor: null,
          unresolvedQuarantine: false,
        };
      }
      if (name.endsWith(":link")) {
        if (crash) {
          throw new Error("Crash before local mapping");
        }
        mapped = true;
        return "linked";
      }
      throw new Error("Unexpected mocked Convex boundary");
    });
  try {
    await expect(main(argv, transport)).rejects.toThrow(
      "Crash before local mapping"
    );
    expect(provider).not.toBeNull();
    expect(mapped).toBe(false);
    expect((await readJournal(journal, pins)).completed).toBe(false);
    crash = false;
    await main([...argv, "--resume"], transport);
    expect(mapped).toBe(true);
    expect((await readJournal(journal, pins)).completed).toBe(true);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = savedKey;
    }
  }
});

// Admission failure modes: the configured key belongs to another environment,
// or a later-page case/space collision would otherwise permit early creations.
test("CLI witness mismatch and later-page normalized collision deny every source export and mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "teak-import-gates-"));
  const key = "test-cli-import-gates-key",
    savedKey = process.env.WORKOS_API_KEY,
    savedFetch = globalThis.fetch;
  const argv = [
    "--deployment",
    "isolated-rehearsal",
    "--environment-id",
    "environment_test",
    "--client-id",
    "client_test",
    "--witness-email",
    "witness@example.com",
    "--witness-external-id",
    "none",
    "--journal",
    join(directory, "journal.json"),
    "--apply",
    "--approval-reference",
    "synthetic-approval",
  ];
  let wrongWitness = true,
    sourceExports = 0,
    writes = 0,
    preflightPages = 0,
    receiptWrites = 0;
  process.env.WORKOS_API_KEY = key;
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve().then(() => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.pathname === "/user_management/users/user_witness") {
          return Response.json({
            object: "user",
            id: "user_witness",
            email: wrongWitness ? "other@example.com" : "witness@example.com",
            email_verified: true,
            external_id: null,
            first_name: null,
            last_name: null,
            profile_picture_url: null,
            locale: null,
            metadata: {},
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-01T00:00:00Z",
            last_sign_in_at: null,
          });
        }
        if ((init?.method ?? "GET") !== "GET") {
          writes++;
        }
        if (url.pathname === "/user_management/users") {
          return Response.json({
            object: "list",
            data: [],
            list_metadata: { before: null, after: null },
          });
        }
        throw new Error("Unexpected provider request");
      }),
    { preconnect: () => undefined }
  );
  const transport = (name: string, args: unknown) =>
    Promise.resolve().then(() => {
      if (name.endsWith(":acquire")) {
        return { holder: (args as { holder: string }).holder, generation: 1 };
      }
      if (name.startsWith("migration/workosImportLease:")) {
        return null;
      }
      if (name.endsWith(":admission")) {
        return { witnessUserId: "user_witness" };
      }
      if (name.endsWith(":preflightPage")) {
        preflightPages++;
        const later = (args as { cursor: string | null }).cursor !== null;
        return {
          owners: [
            {
              teakUserId: later ? "owner_later" : "owner_first",
              email: later ? " OWNER@example.com " : "owner@example.com",
              workosUserId: null,
              deleted: false,
              passwordFormat: "none",
            },
          ],
          done: later,
          cursor: later ? null : "second-page",
        };
      }
      if (name.endsWith(":quarantinePreflight")) {
        const receipts = (args as { receipts: unknown[] }).receipts;
        expect(receipts).toHaveLength(2);
        receiptWrites++;
        return receipts.length;
      }
      sourceExports++;
      throw new Error("A blocked run reached source export or mutation");
    });
  try {
    await expect(main(argv, transport)).rejects.toThrow(
      "provider witness mismatch"
    );
    expect(preflightPages).toBe(0);
    wrongWitness = false;
    await expect(main(argv, transport)).rejects.toThrow(
      "Global normalized-email preflight"
    );
    expect(preflightPages).toBe(2);
    expect(sourceExports).toBe(0);
    expect(receiptWrites).toBe(1);
    expect(writes).toBe(0);
    const fingerprint = createHash("sha256").update(key).digest("hex");
    await expect(
      readJournal(join(directory, "journal.json"), {
        deployment: "isolated-rehearsal",
        environmentId: "environment_test",
        clientId: "client_test",
        apiKeyFingerprint: fingerprint,
        hashesProven: false,
        witnessUserId: "user_witness",
        witnessEmail: "witness@example.com",
        witnessExternalId: null,
      })
    ).rejects.toThrow();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = savedKey;
    }
  }
});

test.each(["email", "delete"] as const)(
  "CLI delta crosses global preflight and safely applies %s change",
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "teak-import-delta-"));
    const key = crypto.randomUUID(),
      savedKey = process.env.WORKOS_API_KEY,
      savedFetch = globalThis.fetch;
    const pins = {
      deployment: "isolated-rehearsal",
      environmentId: "environment_test",
      clientId: "client_test",
      apiKeyFingerprint: createHash("sha256").update(key).digest("hex"),
      hashesProven: false,
      witnessUserId: "user_witness",
      witnessEmail: "witness@example.com",
      witnessExternalId: null,
    };
    const journal = join(directory, "journal.json");
    await writeJournal(
      journal,
      {
        ...admission(pins, null, "initial", "synthetic-approval"),
        completed: true,
        watermark: 1,
      },
      true
    );
    let writes = 0,
      linked = false;
    const remote = (id: string, email: string, externalId: string | null) => ({
      object: "user",
      id,
      email,
      email_verified: false,
      external_id: externalId,
      first_name: null,
      last_name: null,
      profile_picture_url: null,
      locale: null,
      metadata: {},
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      last_sign_in_at: null,
    });
    process.env.WORKOS_API_KEY = key;
    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve().then(() => {
          const path = new URL(
            input instanceof Request ? input.url : String(input)
          ).pathname;
          const method =
            init?.method ?? (input instanceof Request ? input.method : "GET");
          if (path === "/user_management/users/user_witness") {
            return Response.json(
              remote("user_witness", pins.witnessEmail, null)
            );
          }
          if (path === "/user_management/users" && method === "GET") {
            return Response.json({
              object: "list",
              data: [
                remote("user_known", "old@example.com", "permanent_owner"),
              ],
              list_metadata: { before: null, after: null },
            });
          }
          if (path === "/user_management/users/external_id/permanent_owner") {
            return Response.json(
              remote("user_known", "old@example.com", "permanent_owner")
            );
          }
          if (
            path === "/user_management/users/user_known" &&
            method !== "GET"
          ) {
            writes++;
            if (kind === "delete") {
              expect(method).toBe("DELETE");
              return new Response(null, { status: 204 });
            }
            const body = JSON.parse(String(init?.body));
            expect(body).toMatchObject({
              email: "new@example.com",
              email_verified: false,
            });
            return Response.json(
              remote("user_known", body.email, "permanent_owner")
            );
          }
          throw new Error("Unexpected delta provider endpoint");
        }),
      { preconnect: () => undefined }
    );
    const transport = (name: string, args: unknown) =>
      Promise.resolve().then(() => {
        if (name.endsWith(":acquire")) {
          return { holder: (args as { holder: string }).holder, generation: 1 };
        }
        if (name.startsWith("migration/workosImportLease:")) {
          return null;
        }
        if (name.endsWith(":admission")) {
          return { witnessUserId: pins.witnessUserId };
        }
        if (name.endsWith(":preflightPage")) {
          return {
            owners: [
              {
                teakUserId: "permanent_owner",
                email: "new@example.com",
                workosUserId: "user_known",
                deleted: kind === "delete",
                passwordFormat: "none",
              },
            ],
            done: true,
            cursor: null,
          };
        }
        if (name.endsWith(":page")) {
          return {
            owners: [
              {
                teakUserId: "permanent_owner",
                email: "new@example.com",
                emailVerified: false,
                name: "Owner",
                passwordHash: null,
                changedAt: 2,
                deletedAt: kind === "delete" ? 2 : null,
                workosUserId: "user_known",
                sourceVersion: "synthetic-version",
              },
            ],
            done: true,
            cursor: null,
            unresolvedQuarantine: false,
          };
        }
        if (name.endsWith(":link")) {
          linked = true;
          return "linked";
        }
        throw new Error("Unexpected delta Convex endpoint");
      });
    try {
      await main(
        [
          "--deployment",
          pins.deployment,
          "--environment-id",
          pins.environmentId,
          "--client-id",
          pins.clientId,
          "--witness-email",
          pins.witnessEmail,
          "--witness-external-id",
          "none",
          "--journal",
          journal,
          "--apply",
          "--approval-reference",
          "synthetic-approval",
          "--delta",
        ],
        transport
      );
      expect(writes).toBe(1);
      expect(linked).toBe(kind === "email");
      expect(await readJournal(journal, pins)).toMatchObject({
        mode: "delta",
        completed: true,
      });
    } finally {
      globalThis.fetch = savedFetch;
      if (savedKey === undefined) {
        delete process.env.WORKOS_API_KEY;
      } else {
        process.env.WORKOS_API_KEY = savedKey;
      }
    }
  }
);
