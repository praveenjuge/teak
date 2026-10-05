import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./import-users";

// CLI boundary failures: denied acquisition/CAS; provider result uncertainty;
// response received but durable acknowledgment failed. No retry or release may
// turn an uncertain dispatch into permission for a second provider write.
test.each(["acquire", "source", "transport", "server", "acknowledge"] as const)(
  "CLI keeps %s failure fenced",
  async (failure) => {
    const directory = await mkdtemp(join(tmpdir(), "teak-import-lease-"));
    const key = crypto.randomUUID(),
      savedKey = process.env.WORKOS_API_KEY,
      savedFetch = globalThis.fetch;
    let providerWrites = 0,
      releases = 0,
      uncertain = 0,
      links = 0;
    process.env.WORKOS_API_KEY = key;
    const remote = {
      object: "user",
      id: "user_witness",
      email: "witness@example.com",
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
    };
    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve().then(() => {
          const path = new URL(
            input instanceof Request ? input.url : String(input)
          ).pathname;
          const method =
            init?.method ?? (input instanceof Request ? input.method : "GET");
          if (path === "/user_management/users/user_witness") {
            return Response.json(remote);
          }
          if (path === "/user_management/users" && method === "GET") {
            return Response.json({
              object: "list",
              data: [],
              list_metadata: { after: null, before: null },
            });
          }
          if (path === "/user_management/users/external_id/permanent_owner") {
            return Response.json({ message: "Not found" }, { status: 404 });
          }
          if (path === "/user_management/users" && method === "POST") {
            providerWrites++;
            if (failure === "server" && providerWrites === 1) {
              return Response.json(
                { message: "Unknown provider completion" },
                { status: 503 }
              );
            }
            if (failure === "transport") {
              throw new Error("Unknown provider completion");
            }
            return Response.json({
              ...remote,
              id: "user_created",
              email: "owner@example.com",
              email_verified: false,
              external_id: "permanent_owner",
            });
          }
          throw new Error("Unexpected lease-test provider boundary");
        }),
      { preconnect: () => undefined }
    );
    const transport = (name: string, args: unknown) =>
      Promise.resolve().then(() => {
        if (name.endsWith(":admission")) {
          return { witnessUserId: "user_witness" };
        }
        if (name.endsWith(":acquire")) {
          if (failure === "acquire") {
            throw new Error("Importer already active");
          }
          return { holder: (args as { holder: string }).holder, generation: 1 };
        }
        if (name.endsWith(":beginRemote")) {
          if (failure === "source") {
            throw new Error("Importer source changed before dispatch");
          }
          return null;
        }
        if (name.endsWith(":acknowledgeRemote")) {
          throw new Error("Intent acknowledgment failed");
        }
        if (name.endsWith(":release")) {
          releases++;
          return null;
        }
        if (name.endsWith(":markUncertain")) {
          uncertain++;
          return null;
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
                name: null,
                passwordHash: null,
                changedAt: 1,
                deletedAt: null,
                workosUserId: null,
                sourceVersion: "synthetic-source",
              },
            ],
            done: true,
            cursor: null,
            unresolvedQuarantine: false,
          };
        }
        if (name.endsWith(":link")) {
          links++;
          return "linked";
        }
        throw new Error("Unexpected lease-test Convex boundary");
      });
    try {
      await expect(
        main(
          [
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
          ],
          transport
        )
      ).rejects.toThrow();
      expect(providerWrites).toBe(
        failure === "transport" ||
          failure === "server" ||
          failure === "acknowledge"
          ? 1
          : 0
      );
      expect(links).toBe(0);
      expect(releases).toBe(failure === "source" ? 1 : 0);
      expect(uncertain).toBe(
        failure === "transport" ||
          failure === "server" ||
          failure === "acknowledge"
          ? 1
          : 0
      );
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
