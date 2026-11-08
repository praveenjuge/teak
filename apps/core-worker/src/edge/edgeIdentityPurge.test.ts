import { describe, expect, test } from "bun:test";
import { FILES_PROTOCOL_VERSION } from "@teak/files-protocol";
import { type FilesOpsEnv, runFilesOp } from "../ops";
import { FakeBucket } from "../test/testsupport";

const TOKEN_KEY = `key:${"a".repeat(64)}`;
const WORKOS_KEY = "workos:user_01ABC";

class RecordingKv {
  readonly deleted: string[] = [];
  delete(key: string) {
    this.deleted.push(key);
    return Promise.resolve();
  }
}

const purge = (env: Partial<FilesOpsEnv>, keys: unknown) =>
  runFilesOp(
    {
      BUCKET: new FakeBucket() as unknown as R2Bucket,
      FILES_SIGNING_SECRET: "secret",
      ...env,
    } as FilesOpsEnv,
    "request-1",
    {
      op: "purge-edge-identity",
      params: { keys },
      version: FILES_PROTOCOL_VERSION,
    },
    undefined
  );

describe("purge-edge-identity", () => {
  test("forgets each named edge identity entry", async () => {
    const kv = new RecordingKv();
    const answer = await purge(
      { EDGE_IDENTITY: kv as unknown as KVNamespace },
      [TOKEN_KEY, WORKOS_KEY]
    );

    expect(answer.status).toBe(200);
    expect(answer.envelope).toMatchObject({ ok: true, data: { purged: 2 } });
    expect(kv.deleted).toEqual([TOKEN_KEY, WORKOS_KEY]);
  });

  test("purges nothing on a Worker without the edge cache", async () => {
    const answer = await purge({}, [TOKEN_KEY]);
    expect(answer.envelope).toMatchObject({ ok: true, data: { purged: 0 } });
  });

  test.each([
    ["no keys", []],
    ["a key that isn't an edge identity entry", ["link-page:https://x"]],
    ["a malformed token hash", ["key:abc"]],
    ["too many keys", Array.from({ length: 101 }, () => TOKEN_KEY)],
  ])("refuses %s and deletes nothing", async (_label, keys) => {
    const kv = new RecordingKv();
    const answer = await purge(
      { EDGE_IDENTITY: kv as unknown as KVNamespace },
      keys
    );

    expect(answer.status).toBe(400);
    expect(kv.deleted).toEqual([]);
  });
});
