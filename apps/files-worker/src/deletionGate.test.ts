import { describe, expect, test } from "bun:test";
import { freezeObject, gatedBucket, ObjectDeletionGate } from "./deletionGate";
import { FakeBucket, withObjectGates } from "./testsupport";

const fixture = (put: () => Promise<unknown> = () => Promise.resolve(null)) => {
  const values = new Map<string, unknown>();
  const aborted: string[] = [];
  const storage = {
    get(key: string) {
      return Promise.resolve(values.get(key));
    },
    put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === "string") {
        values.set(key, value);
      } else {
        for (const [name, item] of Object.entries(key)) {
          values.set(name, item);
        }
      }
      return Promise.resolve();
    },
    delete(key: string | string[]) {
      for (const name of typeof key === "string" ? [key] : key) {
        values.delete(name);
      }
      return Promise.resolve();
    },
    transaction<T>(callback: (store: typeof storage) => Promise<T>) {
      return callback(storage);
    },
  };
  const env = {
    BUCKET: {
      put,
      createMultipartUpload() {
        return Promise.resolve({ uploadId: "upload_1" });
      },
      resumeMultipartUpload(key: string, id: string) {
        return {
          abort() {
            aborted.push(`${key}/${id}`);
            return Promise.resolve();
          },
          complete: () => Promise.resolve(null),
          uploadPart() {
            return Promise.resolve({ partNumber: 1, etag: "part" });
          },
        };
      },
    },
  };
  const gate = new ObjectDeletionGate(
    { storage } as unknown as DurableObjectState,
    env as unknown as { BUCKET: R2Bucket }
  );
  const request = (op: string, body?: string) =>
    gate.fetch(
      new Request(`https://gate/${op}`, {
        method: "POST",
        headers: { "x-key": "users/exact/file", "x-upload-id": "upload_1" },
        body,
      })
    );
  return { values, aborted, gate, request, env };
};

describe("exact object deletion fence", () => {
  test("freeze permanently denies old and newly signed writes", async () => {
    const t = fixture();
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect((await t.request("put", "private data")).status).toBe(409);
    expect((await t.request("create")).status).toBe(409);
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
  });
  test("an admitted physical write must settle before deletion is acknowledged", async () => {
    let finish!: () => void;
    const t = fixture(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(null);
        })
    );
    const write = t.request("put", "in flight");
    while (!finish) {
      await Promise.resolve();
    }
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: false });
    expect((await t.request("put", "later")).status).toBe(409);
    finish();
    await write;
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect(t.values.has("active")).toBe(false);
  });
  test("ambiguous R2 failures cannot certify deletion", async () => {
    const t = fixture(() => Promise.reject(new Error("R2 unavailable")));
    await expect(t.request("put", "data")).rejects.toThrow("R2 unavailable");
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: false });
    expect(t.values.has("active")).toBe(true);
    expect((await t.request("put", "retry")).status).toBe(409);
  });
  test.each(["create", "complete", "part"])(
    "ambiguous multipart %s cannot certify deletion",
    async (operation) => {
      const t = fixture();
      const failure = () => Promise.reject(new Error("R2 outcome unknown"));
      if (operation === "create") {
        t.env.BUCKET.createMultipartUpload = failure;
      } else {
        t.env.BUCKET.resumeMultipartUpload = () => ({
          abort: () => Promise.resolve(),
          complete: failure,
          uploadPart: failure,
        });
      }
      await expect(
        t.request(operation, operation === "create" ? undefined : "[]")
      ).rejects.toThrow("R2 outcome unknown");
      expect(await (await t.request("freeze")).json()).toEqual({
        frozen: false,
      });
      expect((await t.request("put", "late retry")).status).toBe(409);
    }
  );
  test("multipart creation is idempotent and freeze aborts the captured upload", async () => {
    const t = fixture();
    expect((await t.request("create")).status).toBe(200);
    expect(t.values.get("uploadId")).toBe("upload_1");
    expect((await t.request("create")).status).toBe(200);
    expect(t.values.get("uploadId")).toBe("upload_1");
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect(t.aborted).toEqual(["users/exact/file/upload_1"]);
    expect((await t.request("part", "bytes")).status).toBe(409);
    expect((await t.request("complete", "[]")).status).toBe(409);
  });
  test("persisted unfinished operations stay denied after a restart", async () => {
    const t = fixture();
    t.values.set("active", "crashed-operation");
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: false });
    expect((await t.request("put", "data")).status).toBe(409);
  });
  test("aborting through the gate clears the captured upload before freeze", async () => {
    const t = fixture();
    await t.request("create");
    await t.request("abort");
    expect(t.values.has("uploadId")).toBe(false);
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect(t.aborted).toEqual(["users/exact/file/upload_1"]);
  });
  test("failed conditional puts return null without substituting an existing object", async () => {
    const raw = new FakeBucket();
    raw.objects.set("users/exact/file", { bytes: new Uint8Array([1]) });
    raw.put = () => Promise.resolve(null) as never;
    const env = withObjectGates({ BUCKET: raw as unknown as R2Bucket });
    expect(
      await gatedBucket(env).put("users/exact/file", "new", {
        onlyIf: { etagMatches: "old" },
      })
    ).toBeNull();
    expect(raw.storedBytes("users/exact/file")).toEqual(new Uint8Array([1]));
    expect(await freezeObject(env, "users/exact/file")).toBe(true);
  });
  test("gate returns committed metadata and preserves native conditional options", async () => {
    const raw = new FakeBucket();
    const uploaded = new Date("2026-10-05T00:00:00.000Z");
    const checksum = new Uint8Array([10, 255]).buffer;
    let received: R2PutOptions | undefined;
    raw.put = (_key, _body, options) => {
      received = options as R2PutOptions;
      return Promise.resolve({
        key: "users/exact/file",
        size: 3,
        etag: "committed",
        httpEtag: '"committed"',
        uploaded,
        checksums: { md5: checksum, toJSON: () => ({ md5: "0aff" }) },
        writeHttpMetadata: (headers: Headers) =>
          headers.set("content-type", "text/plain"),
      } as never);
    };
    raw.head = () => {
      throw new Error("must not replace committed result with HEAD");
    };
    const env = withObjectGates({ BUCKET: raw as unknown as R2Bucket });
    const object = await gatedBucket(env).put("users/exact/file", "new", {
      onlyIf: new Headers({ "if-match": '"old"' }),
      httpMetadata: { cacheExpiry: uploaded },
      md5: checksum,
    });
    if (!received) {
      throw new Error("put did not receive its options");
    }
    expect((received.onlyIf as Headers).get("if-match")).toBe('"old"');
    expect((received.httpMetadata as R2HTTPMetadata).cacheExpiry).toEqual(
      uploaded
    );
    expect(received?.md5).toEqual(checksum);
    expect(object?.httpEtag).toBe('"committed"');
    expect(object?.uploaded).toEqual(uploaded);
    expect(object?.checksums.md5).toEqual(checksum);
    expect(object?.checksums.toJSON()).toEqual({ md5: "0aff" });
    const headers = new Headers();
    object?.writeHttpMetadata(headers);
    expect(headers.get("content-type")).toBe("text/plain");
  });
  test("transport preserves legal custom metadata that resembles a type tag", async () => {
    const raw = new FakeBucket();
    const metadata = { gateType: "date", value: "2026-10-05T00:00:00.000Z" };
    let received: R2PutOptions | undefined;
    raw.put = (_key, _body, options) => {
      received = options as R2PutOptions;
      return Promise.resolve({
        key: "users/exact/file",
        customMetadata: received.customMetadata,
        writeHttpMetadata: () => {},
      } as never);
    };
    const env = withObjectGates({ BUCKET: raw as unknown as R2Bucket });
    const object = await gatedBucket(env).put("users/exact/file", "data", {
      customMetadata: metadata,
    });
    expect(received?.customMetadata).toEqual(metadata);
    expect(object?.customMetadata).toEqual(metadata);
  });
  test("multipart completion returns its committed object without a HEAD race", async () => {
    const raw = new FakeBucket();
    const env = withObjectGates({ BUCKET: raw as unknown as R2Bucket });
    const upload =
      await gatedBucket(env).createMultipartUpload("users/exact/file");
    const part = await upload.uploadPart(1, "content");
    raw.head = () => {
      throw new Error("must not HEAD after completion");
    };
    const object = await upload.complete([part]);
    expect(object.key).toBe("users/exact/file");
    expect(object.size).toBe(7);
    expect(raw.storedBytes(object.key)).toEqual(
      new TextEncoder().encode("content")
    );
    expect(await freezeObject(env, object.key)).toBe(true);
  });
  test.each(["freeze", "abort"])(
    "%s accepts an already-absent captured multipart upload",
    async (operation) => {
      const t = fixture();
      await t.request("create");
      t.env.BUCKET.resumeMultipartUpload = () => {
        throw new Error("R2: NoSuchUpload (10024)");
      };
      expect((await t.request(operation)).status).toBe(200);
      expect(t.values.has("uploadId")).toBe(false);
      expect(await (await t.request("freeze")).json()).toEqual({
        frozen: true,
      });
    }
  );
  test("transient multipart abort failure retains cleanup evidence", async () => {
    const t = fixture();
    await t.request("create");
    t.env.BUCKET.resumeMultipartUpload = () => {
      throw new Error("R2: ServiceUnavailable (10043)");
    };
    await expect(t.request("abort")).rejects.toThrow("ServiceUnavailable");
    expect(t.values.get("uploadId")).toBe("upload_1");
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: false });
  });
  test("repeated abort and freeze remain idempotent after provider abortion", async () => {
    const t = fixture();
    await t.request("create");
    await t.request("abort");
    t.env.BUCKET.resumeMultipartUpload = () => {
      throw new Error("R2: NoSuchUpload (10024)");
    };
    expect((await t.request("abort")).status).toBe(200);
    expect(t.values.has("active")).toBe(false);
    expect(t.values.has("uploadId")).toBe(false);
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
  });
  test("transient freeze abortion retains upload evidence and can retry cleanup", async () => {
    const t = fixture();
    await t.request("create");
    const resume = t.env.BUCKET.resumeMultipartUpload;
    t.env.BUCKET.resumeMultipartUpload = () => {
      throw new Error("R2: ServiceUnavailable (10043)");
    };
    await expect(t.request("freeze")).rejects.toThrow("ServiceUnavailable");
    expect(t.values.get("uploadId")).toBe("upload_1");
    expect(t.values.get("uploadKey")).toBe("users/exact/file");
    expect(t.values.get("frozen")).toBe(true);
    expect((await t.request("complete", "[]")).status).toBe(409);
    t.env.BUCKET.resumeMultipartUpload = resume;
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: true });
    expect(t.values.has("uploadId")).toBe(false);
    expect(t.aborted).toEqual(["users/exact/file/upload_1"]);
  });
  test.each(["NoSuchUploadMaybe", "NotNoSuchUpload", "100240", "a10024"])(
    "lookalike absence error %s retains pending deletion evidence",
    async (message) => {
      const t = fixture();
      await t.request("create");
      t.env.BUCKET.resumeMultipartUpload = () => {
        throw new Error(message);
      };
      await expect(t.request("abort")).rejects.toThrow(message);
      expect(t.values.get("uploadId")).toBe("upload_1");
      expect(t.values.get("uploadKey")).toBe("users/exact/file");
      expect(t.values.has("active")).toBe(true);
      expect(await (await t.request("freeze")).json()).toEqual({
        frozen: false,
      });
    }
  );
  test("unstructured thrown absence text retains pending deletion evidence", async () => {
    const t = fixture();
    await t.request("create");
    const resume = t.env.BUCKET.resumeMultipartUpload;
    t.env.BUCKET.resumeMultipartUpload = (key, uploadId) => ({
      ...resume(key, uploadId),
      abort: () => Promise.reject("NoSuchUpload (10024)"),
    });
    await expect(t.request("abort")).rejects.toBe("NoSuchUpload (10024)");
    expect(t.values.get("uploadId")).toBe("upload_1");
    expect(await (await t.request("freeze")).json()).toEqual({ frozen: false });
  });
  test("absent binding refuses unfenced storage access", async () => {
    const bucket = {} as R2Bucket;
    expect(() => gatedBucket({ BUCKET: bucket })).toThrow(
      "object_gate_not_configured"
    );
    await expect(
      freezeObject({ BUCKET: bucket }, "users/exact/file")
    ).rejects.toThrow("not_configured");
  });
});
