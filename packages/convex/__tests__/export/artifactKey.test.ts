import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { buildArtifactKey } from "../../export/runExport";
import { isR2KeyInNamespace } from "../../storage/r2Keys";

const USER_ID = "user_production_fixture";
const JOB_ID = "jh7exportjob123";
// sha256("user_production_fixture").slice(0, 16), pinned so production keys
// cannot drift.
const PRODUCTION_KEY =
  "users/52bb9e6f42e17d00/exports/jh7exportjob123-2026-10-07.zip";

describe("export artifact key", () => {
  let previousPrefix: string | undefined;

  beforeEach(() => {
    previousPrefix = process.env.R2_KEY_PREFIX;
    setSystemTime(new Date("2026-10-07T12:00:00.000Z"));
  });

  afterEach(() => {
    setSystemTime();
    if (previousPrefix === undefined) {
      delete process.env.R2_KEY_PREFIX;
    } else {
      process.env.R2_KEY_PREFIX = previousPrefix;
    }
  });

  test("keeps the production key byte-identical when no prefix is set", () => {
    delete process.env.R2_KEY_PREFIX;

    expect(buildArtifactKey(USER_ID, JOB_ID)).toBe(PRODUCTION_KEY);
  });

  test("writes dev exports and their sidecars inside the dev namespace", () => {
    process.env.R2_KEY_PREFIX = "dev/";

    const key = buildArtifactKey(USER_ID, JOB_ID);

    expect(key).toBe(`dev/${PRODUCTION_KEY}`);
    for (const k of [key, `${key}.checkpoint.json`, `${key}.result.json`]) {
      expect(isR2KeyInNamespace(k)).toBe(true);
    }
  });

  test("the unprefixed production shape is outside the dev namespace", () => {
    process.env.R2_KEY_PREFIX = "dev/";

    expect(isR2KeyInNamespace(PRODUCTION_KEY)).toBe(false);
  });
});
