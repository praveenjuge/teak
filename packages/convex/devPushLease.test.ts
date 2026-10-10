/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { LEASE_TTL_MS } from "./devPushLease";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const main = { id: "mac:/teak", label: "main on mac" };
const worktree = { id: "mac:/teak/wt", label: "feature on mac" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("devPushLease", () => {
  test("refuses any deployment that isn't the shared dev deployment", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", undefined);
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.devPushLease.acquire, { holder: main, force: false })
    ).rejects.toThrow("TEAK_DEV_DEPLOYMENT");
  });

  test("one checkout holds it; another waits until it is released", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.devPushLease.acquire, {
      holder: main,
      force: false,
    });
    expect(first.granted).toBe(true);
    const second = await t.mutation(internal.devPushLease.acquire, {
      holder: worktree,
      force: false,
    });
    expect(second).toMatchObject({
      granted: false,
      state: { holder: { id: main.id, label: main.label } },
    });
    await t.mutation(internal.devPushLease.release, { holderId: main.id });
    expect(
      await t.mutation(internal.devPushLease.acquire, {
        holder: worktree,
        force: false,
      })
    ).toMatchObject({ granted: true });
  });

  test("a forced takeover ends the old holder's next heartbeat", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.devPushLease.acquire, {
      holder: main,
      force: false,
    });
    expect(
      await t.mutation(internal.devPushLease.acquire, {
        holder: worktree,
        force: true,
      })
    ).toMatchObject({ granted: true });
    expect(
      await t.mutation(internal.devPushLease.heartbeat, { holderId: main.id })
    ).toMatchObject({
      granted: false,
      state: { holder: { id: worktree.id } },
    });
  });

  test("a holder that stops renewing loses it after the TTL", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.devPushLease.acquire, {
      holder: main,
      force: false,
    });
    vi.advanceTimersByTime(LEASE_TTL_MS - 1000);
    expect(
      await t.mutation(internal.devPushLease.heartbeat, { holderId: main.id })
    ).toMatchObject({ granted: true });
    vi.advanceTimersByTime(LEASE_TTL_MS + 1000);
    expect(await t.query(internal.devPushLease.status, {})).toMatchObject({
      holder: null,
    });
    expect(
      await t.mutation(internal.devPushLease.acquire, {
        holder: worktree,
        force: false,
      })
    ).toMatchObject({ granted: true });
  });

  test("a holder whose lease expired untaken can take it back", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.devPushLease.acquire, {
      holder: main,
      force: false,
    });
    vi.advanceTimersByTime(LEASE_TTL_MS + 1000);
    expect(
      await t.mutation(internal.devPushLease.heartbeat, { holderId: main.id })
    ).toMatchObject({ granted: false, state: { holder: null } });
    expect(
      await t.mutation(internal.devPushLease.acquire, {
        holder: main,
        force: false,
      })
    ).toMatchObject({ granted: true, state: { holder: { id: main.id } } });
    expect(
      await t.mutation(internal.devPushLease.heartbeat, { holderId: main.id })
    ).toMatchObject({ granted: true });
  });

  test("only the holder records what it pushed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.devPushLease.acquire, {
      holder: main,
      force: false,
    });
    expect(
      await t.mutation(internal.devPushLease.recordPush, {
        holderId: worktree.id,
        label: worktree.label,
        commit: "bbbbbbb",
      })
    ).toBe(false);
    expect(
      await t.mutation(internal.devPushLease.recordPush, {
        holderId: main.id,
        label: main.label,
        commit: "aaaaaaa",
      })
    ).toBe(true);
    expect(await t.query(internal.devPushLease.status, {})).toMatchObject({
      lastPush: { label: main.label, commit: "aaaaaaa" },
    });
  });
});
