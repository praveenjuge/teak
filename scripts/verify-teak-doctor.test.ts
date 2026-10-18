import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendVerdict,
  changedPaths,
  latestPushFailed,
  newestEdit,
} from "../.agents/skills/verify-teak/scripts/doctor.ts";

const READY = "✔ 12:00:01 Convex functions ready! (2.1s)";
const FAILED = "✖ Schema validation failed.\nDocument with ID … in table cards";

describe("verify-teak doctor: latest push outcome", () => {
  test("a schema failure after the last successful push fails", () => {
    expect(latestPushFailed(`${READY}\n${FAILED}\n`)).toBe(true);
  });

  test("a schema failure fixed by a later push doesn't fail", () => {
    expect(latestPushFailed(`${READY}\n${FAILED}\n${READY}\n`)).toBe(false);
  });

  test("a log with only successful pushes, or none yet, doesn't fail", () => {
    expect(latestPushFailed(`${READY}\n`)).toBe(false);
    expect(latestPushFailed("starting convex dev\n")).toBe(false);
  });

  test("a failure before any successful push fails", () => {
    expect(latestPushFailed(`${FAILED}\n`)).toBe(true);
  });
});

describe("verify-teak doctor: backend verdict", () => {
  test("this checkout's live push of matching code is current", () => {
    expect(
      backendVerdict({
        codeMatches: true,
        editedSincePush: false,
        pushedBySelf: true,
        pushing: true,
      })
    ).toBe("current");
  });

  test("an earlier push from this checkout that isn't syncing now is unverified", () => {
    expect(
      backendVerdict({
        codeMatches: true,
        editedSincePush: false,
        pushedBySelf: true,
        pushing: false,
      })
    ).toBe("unverified");
  });

  test("another checkout's push at matching code is unverified", () => {
    expect(
      backendVerdict({
        codeMatches: true,
        editedSincePush: false,
        pushedBySelf: false,
        pushing: false,
      })
    ).toBe("unverified");
  });

  test("an uncommitted edit newer than the last push is unverified while pushing", () => {
    expect(
      backendVerdict({
        codeMatches: true,
        editedSincePush: true,
        pushedBySelf: true,
        pushing: true,
      })
    ).toBe("unverified");
  });

  test("different backend code differs, whoever pushed it", () => {
    expect(
      backendVerdict({
        codeMatches: false,
        editedSincePush: false,
        pushedBySelf: true,
        pushing: true,
      })
    ).toBe("differs");
  });
});

describe("verify-teak doctor: newest uncommitted edit", () => {
  const withTree = (run: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), "verify-teak-doctor-"));
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const at = (seconds: number) => new Date(seconds * 1000);

  test("a file listed inside a new directory counts by its own time", () => {
    withTree((root) => {
      mkdirSync(join(root, "newdir"));
      writeFileSync(join(root, "newdir/foo.ts"), "x");
      utimesSync(join(root, "newdir"), at(1000), at(1000));
      utimesSync(join(root, "newdir/foo.ts"), at(2000), at(2000));
      expect(newestEdit("?? newdir/foo.ts\0", root)).toBe(2_000_000);
    });
  });

  test("a deleted file counts by its parent directory's time", () => {
    withTree((root) => {
      mkdirSync(join(root, "dir"));
      utimesSync(join(root, "dir"), at(3000), at(3000));
      expect(newestEdit(" D dir/gone.ts\0", root)).toBe(3_000_000);
    });
  });

  test("a file in a deleted directory counts by the nearest existing parent", () => {
    withTree((root) => {
      mkdirSync(join(root, "dir"));
      utimesSync(join(root, "dir"), at(4000), at(4000));
      expect(newestEdit(" D dir/gone/a.ts\0", root)).toBe(4_000_000);
    });
  });

  test("no uncommitted paths means no edit", () => {
    expect(newestEdit("")).toBe(0);
  });
});

describe("verify-teak doctor: git status -z records", () => {
  test("keeps paths with spaces and arrows whole, and skips a rename's old path", () => {
    expect(
      changedPaths(
        " M my file.ts\0?? a -> b.ts\0R  new.ts\0old.ts\0 D gone.ts\0"
      )
    ).toEqual(["my file.ts", "a -> b.ts", "new.ts", "gone.ts"]);
  });
});
