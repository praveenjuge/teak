import { isMissingMultipartUpload } from "./missingMultipartUpload";

export interface DeletionGateEnv {
  BUCKET: R2Bucket;
  OBJECT_GATES?: DurableObjectNamespace;
}

export class ObjectWriteBlockedError extends Error {
  constructor() {
    super("Object writes are blocked.");
    this.name = "ObjectWriteBlockedError";
  }
}

type WireValue =
  | null
  | string
  | number
  | boolean
  | ["date", string]
  | ["headers", [string, string][]]
  | ["buffer", number[]]
  | ["array", WireValue[]]
  | ["object", [string, WireValue][]];
const encode = (value: unknown): WireValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return ["date", value.toISOString()];
  }
  if (value instanceof Headers) {
    return ["headers", [...value.entries()]];
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return ["buffer", [...bytes]];
  }
  if (Array.isArray(value)) {
    return ["array", value.map((item) => encode(item ?? null))];
  }
  if (
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return [
      "object",
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, encode(item)]),
    ];
  }
  throw new Error("unsupported_object_gate_wire_value");
};
const decode = (value: WireValue): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }
  switch (value[0]) {
    case "date":
      return new Date(value[1]);
    case "headers":
      return new Headers(value[1]);
    case "buffer":
      return Uint8Array.from(value[1]).buffer;
    case "array":
      return value[1].map(decode);
    case "object":
      return Object.fromEntries(
        value[1].map(([key, item]) => [key, decode(item)])
      );
    default:
      throw new Error("invalid_object_gate_wire_value");
  }
};
const serialize = (value: unknown): string => JSON.stringify(encode(value));
const deserialize = <T>(value: string): T => decode(JSON.parse(value)) as T;
const objectResponse = (object: R2Object | null): Response => {
  if (!object) {
    return new Response("null", {
      headers: { "content-type": "application/json" },
    });
  }
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  return new Response(
    serialize({
      key: object.key,
      version: object.version,
      size: object.size,
      etag: object.etag,
      httpEtag: object.httpEtag,
      uploaded: object.uploaded,
      checksums: Object.fromEntries(
        ["md5", "sha1", "sha256", "sha384", "sha512"].map((algorithm) => [
          algorithm,
          object.checksums?.[algorithm as keyof R2StringChecksums],
        ])
      ),
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      range: object.range,
      storageClass: object.storageClass,
      ssecKeyMd5: object.ssecKeyMd5,
      metadataHeaders: [...headers.entries()],
    }),
    { headers: { "content-type": "application/json" } }
  );
};
const restoreObject = (value: unknown): R2Object | null => {
  if (value === null) {
    return null;
  }
  const { metadataHeaders, ...object } = value as R2Object & {
    metadataHeaders: [string, string][];
  };
  const checksums = object.checksums ?? {};
  return {
    ...object,
    checksums: {
      ...checksums,
      toJSON: () =>
        Object.fromEntries(
          Object.entries(checksums)
            .filter(([, checksum]) => checksum instanceof ArrayBuffer)
            .map(([algorithm, checksum]) => [
              algorithm,
              [...new Uint8Array(checksum as ArrayBuffer)]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join(""),
            ])
        ),
    },
    writeHttpMetadata(headers: Headers) {
      for (const [name, item] of metadataHeaders) {
        headers.set(name, item);
      }
    },
  };
};

/**
 * Durable state of one object key's gate. `active` holds the token of the
 * admitted write; a write that throws leaves it set, because R2 may still
 * commit it, so the key can never be certified as deleted.
 */
interface GateState {
  active: string;
  frozen: true;
  uploadId: string;
  uploadKey: string;
}

type GateStorage = Pick<DurableObjectTransaction, "get">;

const readGate = <K extends keyof GateState>(
  storage: GateStorage,
  key: K
): Promise<GateState[K] | undefined> => storage.get<GateState[K]>(key);

const GATE_WRITES = ["abort", "complete", "create", "part", "put"] as const;
type GateWrite = (typeof GATE_WRITES)[number];

const isGateWrite = (op: string): op is GateWrite =>
  (GATE_WRITES as readonly string[]).includes(op);

export class ObjectDeletionGate {
  private readonly state: DurableObjectState;
  private readonly env: DeletionGateEnv;
  constructor(state: DurableObjectState, env: DeletionGateEnv) {
    this.state = state;
    this.env = env;
  }
  private async abortUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.env.BUCKET.resumeMultipartUpload(key, uploadId).abort();
    } catch (error) {
      if (!isMissingMultipartUpload(error)) {
        throw error;
      }
    }
  }
  private async forgetUpload(uploadId: string): Promise<void> {
    if ((await readGate(this.state.storage, "uploadId")) === uploadId) {
      await this.state.storage.delete(["uploadId", "uploadKey"]);
    }
  }
  private async freeze(): Promise<Response> {
    const storage = this.state.storage;
    const busy = await storage.transaction(async (txn) => {
      await txn.put("frozen", true);
      return Boolean(await readGate(txn, "active"));
    });
    if (!busy) {
      const uploadId = await readGate(storage, "uploadId");
      const uploadKey = await readGate(storage, "uploadKey");
      if (uploadId && uploadKey) {
        await this.abortUpload(uploadKey, uploadId);
        await storage.delete(["uploadId", "uploadKey"]);
      }
    }
    return Response.json({ frozen: !busy });
  }
  private readonly writes: Record<
    GateWrite,
    (key: string, request: Request) => Promise<Response>
  > = {
    put: async (key, request) => {
      const options = deserialize<R2PutOptions>(
        request.headers.get("x-options") ?? serialize({})
      );
      return objectResponse(
        await this.env.BUCKET.put(key, request.body, options)
      );
    },
    create: async (key, request) => {
      const options = deserialize<R2MultipartOptions>(
        request.headers.get("x-options") ?? serialize({})
      );
      const previous = await readGate(this.state.storage, "uploadId");
      if (previous) {
        return new Response(serialize({ uploadId: previous }));
      }
      const upload = await this.env.BUCKET.createMultipartUpload(key, options);
      await this.state.storage.put({
        uploadId: upload.uploadId,
        uploadKey: key,
      });
      return new Response(serialize({ uploadId: upload.uploadId }));
    },
    part: async (key, request) => {
      const part = await this.env.BUCKET.resumeMultipartUpload(
        key,
        request.headers.get("x-upload-id") ?? ""
      ).uploadPart(
        Number(request.headers.get("x-part")),
        request.body ?? new Uint8Array()
      );
      return new Response(
        serialize({ partNumber: part.partNumber, etag: part.etag })
      );
    },
    complete: async (key, request) => {
      const uploadId = request.headers.get("x-upload-id") ?? "";
      const object = await this.env.BUCKET.resumeMultipartUpload(
        key,
        uploadId
      ).complete((await request.json()) as R2UploadedPart[]);
      await this.forgetUpload(uploadId);
      return objectResponse(object);
    },
    abort: async (key, request) => {
      const uploadId = request.headers.get("x-upload-id") ?? "";
      await this.abortUpload(key, uploadId);
      await this.forgetUpload(uploadId);
      return new Response(serialize({ ok: true }));
    },
  };
  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.slice(1);
    if (op === "status") {
      return Response.json({
        frozen: (await readGate(this.state.storage, "frozen")) === true,
      });
    }
    if (op === "freeze") {
      return await this.freeze();
    }
    const key = request.headers.get("x-key");
    if (!key) {
      return new Response("missing_key", { status: 400 });
    }
    if (!isGateWrite(op)) {
      await request.body?.cancel();
      return new Response("invalid_gate_operation", { status: 400 });
    }
    const token = crypto.randomUUID();
    const admitted = await this.state.storage.transaction(async (txn) => {
      if (
        (op !== "abort" && (await readGate(txn, "frozen"))) ||
        (await readGate(txn, "active"))
      ) {
        return false;
      }
      await txn.put("active", token);
      return true;
    });
    if (!admitted) {
      await request.body?.cancel();
      return new Response("object_write_fenced_or_busy", { status: 409 });
    }
    const response = await this.writes[op](key, request);
    await this.state.storage.transaction(async (txn) => {
      if ((await readGate(txn, "active")) === token) {
        await txn.delete("active");
      }
    });
    return response;
  }
}
export async function freezeObject(
  env: DeletionGateEnv,
  key: string
): Promise<boolean> {
  if (!env.OBJECT_GATES) {
    throw new Error("object_gate_not_configured");
  }
  const stub = env.OBJECT_GATES.get(env.OBJECT_GATES.idFromName(key));
  const response = await stub.fetch("https://object-gate/freeze", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("object_gate_unavailable");
  }
  return ((await response.json()) as { frozen: boolean }).frozen === true;
}

// All new Worker writes require the gate. Rollout must provision the binding
// and drain unfenced historical writers before enabling account deletion.
export function gatedBucket(env: DeletionGateEnv): R2Bucket {
  if (!env.OBJECT_GATES) {
    throw new Error("object_gate_not_configured");
  }
  const raw = env.BUCKET;
  const gates = env.OBJECT_GATES;
  async function write(
    key: string,
    op: GateWrite,
    body?: BodyInit | null,
    headers: Record<string, string> = {}
  ) {
    const response = await gates
      .get(gates.idFromName(key))
      .fetch(`https://object-gate/${op}`, {
        method: "POST",
        body,
        headers: { "x-key": key, ...headers },
      });
    if (response.status === 409) {
      await response.body?.cancel();
      throw new ObjectWriteBlockedError();
    }
    if (!response.ok) {
      throw new Error(`object_gate_write_${response.status}`);
    }
    return deserialize<unknown>(await response.text());
  }
  const multipart = (key: string, uploadId: string): R2MultipartUpload => ({
    key,
    uploadId,
    uploadPart: async (number, body) =>
      (await write(key, "part", body as BodyInit, {
        "x-upload-id": uploadId,
        "x-part": String(number),
      })) as R2UploadedPart,
    complete: async (parts) => {
      const object = restoreObject(
        await write(key, "complete", JSON.stringify(parts), {
          "x-upload-id": uploadId,
        })
      );
      if (!object) {
        throw new Error("completed_object_missing");
      }
      return object;
    },
    abort: async () => {
      await write(key, "abort", null, { "x-upload-id": uploadId });
    },
  });
  return new Proxy(raw, {
    get(target, property) {
      if (property === "put") {
        return async (
          key: string,
          body: BodyInit | null,
          options: R2PutOptions = {}
        ) =>
          restoreObject(
            await write(key, "put", body, { "x-options": serialize(options) })
          );
      }
      if (property === "createMultipartUpload") {
        return async (key: string, options: R2MultipartOptions = {}) => {
          const result = (await write(key, "create", null, {
            "x-options": serialize(options),
          })) as { uploadId: string };
          return multipart(key, result.uploadId);
        };
      }
      if (property === "resumeMultipartUpload") {
        return multipart;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function objectIsFrozen(
  env: DeletionGateEnv,
  key: string
): Promise<boolean> {
  if (!env.OBJECT_GATES) {
    throw new Error("object_gate_not_configured");
  }
  const response = await env.OBJECT_GATES.get(
    env.OBJECT_GATES.idFromName(key)
  ).fetch("https://object-gate/status");
  if (!response.ok) {
    throw new Error("object_gate_unavailable");
  }
  return ((await response.json()) as { frozen: boolean }).frozen === true;
}
