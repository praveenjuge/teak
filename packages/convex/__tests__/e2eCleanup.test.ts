import { describe, expect, mock, test } from "bun:test";
import {
  deleteE2ECleanupCandidates,
  e2eCleanupPlugin,
  isE2EEmail,
  isWithinCleanupAge,
  normalizeE2EEmailDomain,
  provisionE2EAccount,
  requireE2EEmailDomain,
  resolveExactE2ECleanupCandidates,
  resolveOrphanE2ECleanupCandidates,
} from "../e2eCleanup";

describe("production E2E cleanup safety", () => {
  test("normalizes only valid configured domains", () => {
    expect(normalizeE2EEmailDomain(" Tests.Example.COM ")).toBe(
      "tests.example.com"
    );
    for (const domain of ["", "localhost", "@example.com", "-bad.example"]) {
      expect(() => normalizeE2EEmailDomain(domain)).toThrow();
    }
  });

  test("reports invalid endpoint configuration as unavailable", () => {
    expect(() => requireE2EEmailDomain("not-a-domain")).toThrow(
      "E2E account automation is misconfigured"
    );
  });

  test("accepts only the configured E2E namespace", () => {
    const domain = "tests.example.com";
    expect(isE2EEmail("e2e-primary-123-abc@tests.example.com", domain)).toBe(
      true
    );
    expect(isE2EEmail("person@tests.example.com", domain)).toBe(false);
    expect(isE2EEmail("e2e-primary-123-abc@example.com", domain)).toBe(false);
    expect(isE2EEmail("e2e-../../unsafe@tests.example.com", domain)).toBe(
      false
    );
  });

  test("enforces lower and upper account-age bounds", () => {
    const now = Date.UTC(2026, 6, 10);
    expect(
      isWithinCleanupAge({
        createdAt: now - 60_000,
        maxAgeMs: 120_000,
        minAgeMs: 30_000,
        now,
      })
    ).toBe(true);
    expect(
      isWithinCleanupAge({
        createdAt: now - 10_000,
        maxAgeMs: 120_000,
        minAgeMs: 30_000,
        now,
      })
    ).toBe(false);
    expect(
      isWithinCleanupAge({
        createdAt: now - 10 * 60_000,
        maxAgeMs: 120_000,
        minAgeMs: 30_000,
        now,
      })
    ).toBe(false);
  });

  test("registers schema-free protected provisioning and cleanup endpoints", () => {
    const plugin = e2eCleanupPlugin({} as never);
    expect(plugin.id).toBe("teak-e2e-cleanup");
    expect(plugin.schema).toBeUndefined();
    expect(plugin.endpoints?.provisionE2EAccount).toBeDefined();
    expect(plugin.endpoints?.cleanupE2EAccounts).toBeDefined();
  });

  test("provisions a verified credential account without email delivery", async () => {
    const findUserByEmail = mock(async () => null);
    const createUser = mock(async (input: Record<string, unknown>) => ({
      ...input,
      id: "user-1",
    }));
    const linkAccount = mock(async () => undefined);
    const deleteUser = mock(async () => undefined);
    const hash = mock(async (password: string) => `hashed:${password}`);
    const result = await provisionE2EAccount({
      authCtx: {
        internalAdapter: {
          createUser,
          deleteUser,
          findUserByEmail,
          linkAccount,
        },
        password: {
          config: { maxPasswordLength: 128, minPasswordLength: 8 },
          hash,
        },
      } as never,
      domain: "tests.example.com",
      email: "E2E-Primary-123@Tests.Example.Com",
      password: "safe-password",
    });

    expect(result).toEqual({
      email: "e2e-primary-123@tests.example.com",
    });
    expect(createUser).toHaveBeenCalledWith({
      email: "e2e-primary-123@tests.example.com",
      emailVerified: true,
      name: "Production E2E",
    });
    expect(linkAccount).toHaveBeenCalledWith({
      accountId: "user-1",
      password: "hashed:safe-password",
      providerId: "credential",
      userId: "user-1",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  test("rejects unsafe provisioning and rolls back credential failures", async () => {
    const deleteUser = mock(async () => undefined);
    const authCtx = {
      internalAdapter: {
        createUser: mock(async () => ({ id: "user-1" })),
        deleteUser,
        findUserByEmail: mock(async () => null),
        linkAccount: mock(() => {
          throw new Error("link failed");
        }),
      },
      password: {
        config: { maxPasswordLength: 128, minPasswordLength: 8 },
        hash: mock(async () => "hash"),
      },
    } as never;

    await expect(
      provisionE2EAccount({
        authCtx,
        domain: "tests.example.com",
        email: "person@example.com",
        password: "safe-password",
      })
    ).rejects.toThrow("Invalid E2E email");
    await expect(
      provisionE2EAccount({
        authCtx,
        domain: "tests.example.com",
        email: "e2e-primary@tests.example.com",
        password: "safe-password",
      })
    ).rejects.toThrow("link failed");
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  test("exact cleanup separates missing, eligible, and unsafe accounts", async () => {
    const now = Date.UTC(2026, 6, 10);
    const findUserByEmail = mock((email: string) => {
      if (email.startsWith("e2e-missing")) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        accounts: [],
        user: {
          createdAt: new Date(
            now - (email.startsWith("e2e-old") ? 48 : 1) * 60 * 60 * 1000
          ),
          email,
          id: email,
        },
      });
    });
    const result = await resolveExactE2ECleanupCandidates({
      authCtx: { internalAdapter: { findUserByEmail } } as never,
      domain: "tests.example.com",
      emails: [
        "e2e-live@tests.example.com",
        "e2e-missing@tests.example.com",
        "e2e-old@tests.example.com",
      ],
      now,
    });

    expect(result.candidates.map((candidate) => candidate.email)).toEqual([
      "e2e-live@tests.example.com",
    ]);
    expect(result.alreadyDeleted).toEqual(["e2e-missing@tests.example.com"]);
    expect(result.ignoredOutOfRange).toEqual(["e2e-old@tests.example.com"]);
    expect(findUserByEmail).toHaveBeenCalledTimes(3);
    expect(
      resolveExactE2ECleanupCandidates({
        authCtx: { internalAdapter: { findUserByEmail } } as never,
        domain: "tests.example.com",
        emails: ["person@example.com"],
        now,
      })
    ).rejects.toThrow("Invalid E2E email");
  });

  test("orphan cleanup is server-filtered, bounded, and reports overflow", async () => {
    const now = Date.UTC(2026, 6, 10);
    const users = Array.from({ length: 201 }, (_, index) => ({
      createdAt: new Date(now - 60 * 60 * 1000),
      email: `e2e-orphan-${index}@tests.example.com`,
      id: `user-${index}`,
    }));
    const listUsers = mock(async () => users);
    const result = await resolveOrphanE2ECleanupCandidates({
      authCtx: { internalAdapter: { listUsers } } as never,
      domain: "tests.example.com",
      now,
    });

    expect(result.candidates).toHaveLength(200);
    expect(result.remainingEligible).toBe(true);
    expect(listUsers).toHaveBeenCalledTimes(1);
    const [limit, offset, sortBy, where] = listUsers.mock.calls[0];
    expect(limit).toBe(201);
    expect(offset).toBe(0);
    expect(sortBy).toEqual({ direction: "asc", field: "createdAt" });
    expect(where).toContainEqual({
      field: "email",
      operator: "ends_with",
      value: "@tests.example.com",
    });
  });

  test("deletion removes Teak data before auth and surfaces failures", async () => {
    const runAction = mock((_reference: unknown, { userId }: any) => {
      if (userId === "user-2") {
        return Promise.reject(new Error("mutation failed"));
      }
      return Promise.resolve();
    });
    const deleteUser = mock(() => Promise.resolve());
    const originalConsoleError = console.error;
    console.error = mock();
    try {
      const result = await deleteE2ECleanupCandidates({
        appCtx: { runAction } as never,
        authCtx: { internalAdapter: { deleteUser } } as never,
        candidates: [
          {
            createdAt: new Date(),
            email: "e2e-one@tests.example.com",
            id: "user-1",
          },
          {
            createdAt: new Date(),
            email: "e2e-two@tests.example.com",
            id: "user-2",
          },
        ],
      });

      expect(result.deleted).toEqual(["e2e-one@tests.example.com"]);
      expect(result.failures).toEqual([
        {
          email: "e2e-two@tests.example.com",
          reason: "account cleanup failed",
        },
      ]);
      expect(runAction).toHaveBeenCalledTimes(2);
      expect(deleteUser).toHaveBeenCalledTimes(1);
      expect(deleteUser).toHaveBeenCalledWith("user-1");
    } finally {
      console.error = originalConsoleError;
    }
  });
});
