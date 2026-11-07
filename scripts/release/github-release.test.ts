import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRelease, waitForRelease } from "./github-release.ts";

const WORKFLOWS = join(import.meta.dir, "../../.github/workflows");

test("only Version Tag creates a GitHub Release; release workflows wait for it", () => {
  // Release jobs used to race `gh release create … || true` with different
  // titles. Each workflow that uploads to a release waits for it instead.
  const creators: string[] = [];
  const uploadersThatDontWait: string[] = [];
  for (const name of readdirSync(WORKFLOWS).sort()) {
    const text = readFileSync(join(WORKFLOWS, name), "utf8");
    if (
      /gh release create|github-release\.ts create|releases.*-X POST/.test(text)
    ) {
      creators.push(name);
    }
    if (
      text.includes("gh release upload") &&
      !text.includes("github-release.ts wait")
    ) {
      uploadersThatDontWait.push(name);
    }
  }
  expect(creators).toEqual(["version-tag.yml"]);
  expect(uploadersThatDontWait).toEqual([]);
});

const missing = {
  status: 1,
  stderr: "release not found",
  stdout: "",
};
const ok = { status: 0, stderr: "", stdout: "{}" };

/** A fake `gh` that answers `release view` from `views` in order. */
const fakeGh = (
  views: { status: number; stderr: string; stdout: string }[]
) => {
  const calls: string[][] = [];
  const execute = (_: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "view") {
      return views.shift() ?? ok;
    }
    return ok;
  };
  return { calls, execute };
};

describe("createRelease", () => {
  test("creates a missing release titled with its tag", () => {
    const gh = fakeGh([missing]);
    expect(
      createRelease("praveenjuge/teak", "v1.0.94", { execute: gh.execute })
    ).toBe("created");
    expect(gh.calls[1]).toEqual([
      "release",
      "create",
      "v1.0.94",
      "--repo",
      "praveenjuge/teak",
      "--verify-tag",
      "--title",
      "v1.0.94",
      "--generate-notes",
    ]);
  });

  test("leaves an existing release alone", () => {
    const gh = fakeGh([ok]);
    expect(
      createRelease("praveenjuge/teak", "v1.0.94", { execute: gh.execute })
    ).toBe("exists");
    expect(gh.calls).toHaveLength(1);
  });

  test("fails on any other error instead of creating blindly", () => {
    const gh = fakeGh([{ status: 1, stderr: "HTTP 403", stdout: "" }]);
    expect(() =>
      createRelease("praveenjuge/teak", "v1.0.94", { execute: gh.execute })
    ).toThrow("HTTP 403");
    expect(gh.calls).toHaveLength(1);
  });

  test.each([
    ["../other", "v1.0.94"],
    ["praveenjuge/teak", "--help"],
  ])("rejects unsafe identity %s %s", (repository, tag) => {
    expect(() => createRelease(repository, tag)).toThrow(
      "Invalid GitHub Release identity"
    );
  });
});

describe("waitForRelease", () => {
  test("waits until Version Tag has created the release", async () => {
    const gh = fakeGh([missing, missing, ok]);
    await waitForRelease("praveenjuge/teak", "v1.0.94", {
      execute: gh.execute,
      wait: () => Promise.resolve(),
    });
    expect(gh.calls).toHaveLength(3);
    expect(gh.calls.every((args) => args[1] === "view")).toBe(true);
  });

  test("says how to create a release that never appears", async () => {
    let time = 0;
    const gh = fakeGh(Array.from({ length: 100 }, () => missing));
    await expect(
      waitForRelease("praveenjuge/teak", "v1.0.94", {
        execute: gh.execute,
        now: () => time,
        wait: (ms) => {
          time += ms;
          return Promise.resolve();
        },
      })
    ).rejects.toThrow(
      "node scripts/release/github-release.ts create praveenjuge/teak v1.0.94"
    );
    // It never creates the release itself.
    expect(gh.calls.every((args) => args[1] === "view")).toBe(true);
  });

  test("fails at once when GitHub refuses", async () => {
    const gh = fakeGh([{ status: 1, stderr: "HTTP 401", stdout: "" }]);
    await expect(
      waitForRelease("praveenjuge/teak", "v1.0.94", {
        execute: gh.execute,
        wait: () => Promise.reject(new Error("unexpected retry")),
      })
    ).rejects.toThrow("HTTP 401");
  });
});
