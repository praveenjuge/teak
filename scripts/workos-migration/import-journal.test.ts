import { expect, test } from "bun:test";
import { chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admission, readJournal, writeJournal } from "./import-journal";

const pins = {
  deployment: "isolated-rehearsal",
  environmentId: "environment_test",
  clientId: "client_test",
  apiKeyFingerprint: "synthetic-fingerprint",
  hashesProven: false,
  witnessUserId: "user_witness",
  witnessEmail: "witness@example.com",
  witnessExternalId: null,
};
const path = async () =>
  join(await mkdtemp(join(tmpdir(), "teak-import-journal-")), "journal.json");
// Failure modes: crash in first page before checkpoint; interrupted delta loses
// operation/watermark; wrong credentials or world-readable journal resumes.
test("private admission survives a first-page crash before any checkpoint", async () => {
  const file = await path(),
    started = admission(pins, null, "initial", "test-approval");
  await writeJournal(file, started, true);
  const resumed = admission(
    pins,
    await readJournal(file, pins),
    "resume",
    "test-resume-approval"
  );
  expect(resumed).toEqual(started);
  expect(resumed.cursor).toBeNull();
  expect(resumed.completed).toBe(false);
  expect((await stat(file)).mode % 0o100).toBe(0);
  await expect(writeJournal(file, started, true)).rejects.toThrow();
});
test("interrupted delta resumes its admitted mode and earlier change watermark", async () => {
  const file = await path(),
    initial = admission(pins, null, "initial", "test-initial");
  const completed = {
    ...initial,
    completed: true,
    watermark: initial.startedAt,
  };
  await writeJournal(file, completed, true);
  const delta = admission(
    pins,
    await readJournal(file, pins),
    "delta",
    "test-delta"
  );
  await writeJournal(file, delta, false);
  const resumed = admission(
    pins,
    await readJournal(file, pins),
    "resume",
    "test-resume"
  );
  expect(resumed.mode).toBe("delta");
  expect(resumed.watermark).toBe(initial.startedAt);
  expect(resumed.startedAt).toBe(delta.startedAt);
});
test("pin changes and readable-by-others journals fail closed", async () => {
  const file = await path();
  await writeJournal(
    file,
    admission(pins, null, "initial", "test-approval"),
    true
  );
  await expect(
    readJournal(file, { ...pins, apiKeyFingerprint: "different" })
  ).rejects.toThrow("pins changed");
  await chmod(file, 0o644);
  await expect(readJournal(file, pins)).rejects.toThrow("owner-only");
});

test("reset-only password policy is pinned across resume and delta", async () => {
  const file = await path();
  const admitted = { ...pins, resetPasswords: true };
  await writeJournal(
    file,
    admission(admitted, null, "initial", "synthetic-reset-approval"),
    true
  );
  expect((await readJournal(file, admitted)).resetPasswords).toBe(true);
  await expect(readJournal(file, pins)).rejects.toThrow(
    "password policy changed"
  );
  await expect(
    readJournal(file, { ...admitted, resetPasswords: false })
  ).rejects.toThrow("password policy changed");
});
