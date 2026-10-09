import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import {
  isPortInUse,
  isUsableSlot,
  MAIN_PORTS,
  mainWorktreePorts,
  pickSlot,
  slotPorts,
  stackPorts,
} from "./worktree-env.ts";

const never = async () => false;

describe("worktree-env", () => {
  test("main checkout keeps the fixed ports", () => {
    expect(mainWorktreePorts()).toMatchObject({
      namespace: "main",
      namespaced: false,
      ...MAIN_PORTS,
      siteUrl: "http://localhost:3000",
    });
  });

  test("a slot holds one stack's ports", () => {
    const ports = slotPorts(3);
    expect(ports).toMatchObject({
      namespace: "wt-3",
      web: 4300,
      docs: 4301,
      extension: 4302,
      convex: 4310,
      convexSite: 4311,
      emulator: 4320,
      siteUrl: "http://localhost:4300",
    });
    expect(new Set(stackPorts(ports)).size).toBe(7);
  });

  test("slots that reuse main or macOS AirPlay ports are never usable", () => {
    const main = new Set(stackPorts(mainWorktreePorts()));
    for (let slot = 0; slot < 40; slot++) {
      const ports = stackPorts(slotPorts(slot));
      const clashes = ports.some(
        (port) => main.has(port) || port === 5000 || port === 7000
      );
      expect(isUsableSlot(slot)).toBe(!clashes);
    }
    expect(isUsableSlot(1)).toBe(false);
    expect(isUsableSlot(10)).toBe(false);
    expect(isUsableSlot(30)).toBe(false);
    expect(isUsableSlot(40)).toBe(false);
  });

  test("a worktree keeps its lease", async () => {
    expect(await pickSlot("/work/a", { "/work/a": 7 }, never)).toBe(7);
  });

  test("two worktrees never share a slot", async () => {
    const first = await pickSlot("/work/a", {}, never);
    const second = await pickSlot("/work/b", { "/work/a": first }, never);
    expect(second).not.toBe(first);
    expect(isUsableSlot(first) && isUsableSlot(second)).toBe(true);
  });

  test("a slot whose ports are busy is skipped", async () => {
    const preferred = await pickSlot("/work/a", {}, never);
    const chosen = await pickSlot(
      "/work/a",
      {},
      async (slot) => slot === preferred
    );
    expect(chosen).not.toBe(preferred);
  });

  test("fails clearly when every slot is taken", async () => {
    const leases = Object.fromEntries(
      Array.from({ length: 40 }, (_, slot) => [`/work/${slot}`, slot])
    );
    await expect(pickSlot("/work/new", leases, never)).rejects.toThrow(
      "git worktree remove"
    );
  });

  test("isPortInUse detects a listener and a free port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(await isPortInUse(port)).toBe(true);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    expect(await isPortInUse(port)).toBe(false);
  });
});
