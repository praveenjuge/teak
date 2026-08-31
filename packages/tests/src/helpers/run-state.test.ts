import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "bun";

const directory = mkdtempSync(`${tmpdir()}/teak-run-state-`);
const stateFile = resolve(directory, "run-state.json");
const writerFile = resolve(import.meta.dir, "run-state-writer.fixture.ts");

afterAll(() => rmSync(directory, { recursive: true }));

test("serializes state updates from concurrent Playwright workers", async () => {
  const spawnWriter = (label: string) =>
    spawn({
      cmd: [process.execPath, writerFile, label],
      env: { ...process.env, TEAK_E2E_RUN_STATE_FILE: stateFile },
      stderr: "pipe",
      stdout: "pipe",
    });

  const writers = [spawnWriter("a-"), spawnWriter("b-")];
  const exitCodes = await Promise.all(writers.map((writer) => writer.exited));
  expect(exitCodes).toEqual([0, 0]);

  const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
    createdCardIds: string[];
  };
  expect(new Set(state.createdCardIds).size).toBe(80);
});
