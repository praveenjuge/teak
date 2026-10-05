import { expect, test } from "bun:test";
import { type PreflightOwner, preflight } from "./preflight";

const owner = (teakUserId: string, email: string): PreflightOwner => ({
  teakUserId,
  email,
  workosUserId: null,
  deleted: false,
  passwordFormat: "compatible",
});
test("normalizes case and surrounding spaces while preserving Gmail dots and plus aliases", () => {
  const result = preflight(
    [
      owner("a", " Person@Example.com "),
      owner("b", "person@example.com"),
      owner("c", "p.erson@gmail.com"),
      owner("d", "person+alias@gmail.com"),
    ],
    []
  );
  expect(result.clear).toBe(false);
  expect(result.issues).toEqual([
    {
      reason: "duplicate_email",
      email: "person@example.com",
      teakUserIds: ["a", "b"],
    },
  ]);
  expect(result.passwords.compatible).toBe(4);
});
test("accepts only the matching external-owner provider and reports occupied or contradictory emails", () => {
  const rows = [owner("owner", "owner@example.com")];
  expect(
    preflight(rows, [
      { id: "user_expected", externalId: "owner", email: "owner@example.com" },
    ]).clear
  ).toBe(true);
  expect(
    preflight(rows, [
      { id: "user_unlinked", externalId: null, email: "owner@example.com" },
    ]).issues
  ).toMatchObject([{ reason: "provider_email_collision" }]);
  expect(
    preflight(rows, [
      { id: "user_wrong", externalId: "owner", email: "other@example.com" },
    ]).issues
  ).toMatchObject([{ reason: "external_id_mismatch" }]);
});

test("provider-only normalized duplicates cannot produce a clear preflight", () => {
  const result = preflight(
    [],
    [
      {
        id: "user_first",
        email: "unused@example.com",
        externalId: "owner_remote",
      },
      {
        id: "user_second",
        email: " UNUSED@example.com ",
        externalId: "owner_remote",
      },
    ]
  );
  expect(result.clear).toBe(false);
  expect(result.issues.map((row) => row.reason)).toEqual([
    "duplicate_provider_identity",
    "duplicate_provider_email",
  ]);
});

// Delta must remove known deleted identities and update prior emails without
// allowing one owner to take another owner's current address.
test("delta accepts known email changes and tombstones, but preserves ownership collision fences", () => {
  const changed = {
    ...owner("owner", "new@example.com"),
    workosUserId: "user_known",
  };
  const remote = {
    id: "user_known",
    externalId: "owner",
    email: "old@example.com",
  };
  expect(preflight([changed], [remote], true).clear).toBe(true);
  expect(preflight([changed], [remote]).clear).toBe(false);
  expect(preflight([{ ...changed, deleted: true }], [remote], true).clear).toBe(
    true
  );
  expect(
    preflight([{ ...changed, email: remote.email, deleted: true }], [remote])
      .clear
  ).toBe(true);
  expect(
    preflight([changed, owner("other", "old@example.com")], [remote], true)
      .clear
  ).toBe(false);
  expect(
    preflight([changed], [{ ...remote, id: "user_wrong" }], true).clear
  ).toBe(false);
});
