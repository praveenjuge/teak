import {
  FILES_PROTOCOL_VERSION,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesOp,
  readFilesAiGenerationFacts,
} from "@teak/files-protocol";
import { gatedBucket } from "../deletionGate";
import { type FilesOpsEnv, runFilesOp } from "../ops";
import { retryingReads } from "../r2Retry";

/**
 * Workflow steps run Files ops in-process, with the same contract Convex's
 * `callFilesWorkerJson` gives them over HTTP, so ported step code keeps its
 * fallback and retry behavior:
 * - ok: the op succeeded
 * - fallback: the op deliberately declined (missing source, too large,
 *   unsupported, or one of `fallbackCodes`)
 *
 * Everything else throws: `files_worker_ai: rate limit reached 429` and
 * `files_worker_ai: failed to validate JSON` for the AI codes, otherwise
 * `files_worker_error:<CODE>:<status>:<requestId>`, so step retries apply.
 */
export type FilesOpOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "fallback"; code: FilesErrorCode; message: string };

/**
 * In-process ops still need the Worker's public origin: large images are
 * transformed by URL through this Worker's own image-source route.
 */
const DEFAULT_PUBLIC_ORIGIN = "https://files.teakvault.com";

/**
 * The env an op sees over HTTP: writes pass the object deletion gates, so
 * account deletion's freeze fences them, and reads retry. Workflows writing
 * to the bucket directly use it too. Without gates (tests) it is unchanged.
 */
export const gatedEnv = <Env extends FilesOpsEnv>(env: Env): Env =>
  env.OBJECT_GATES
    ? {
        ...env,
        BUCKET: gatedBucket({ ...env, BUCKET: retryingReads(env.BUCKET) }),
      }
    : env;

export const callFilesOp = async <T>(
  env: FilesOpsEnv,
  spec: {
    fallbackCodes?: readonly FilesErrorCode[];
    op: FilesOp;
    params: Record<string, unknown>;
  }
): Promise<FilesOpOutcome<T>> => {
  const requestId = `wf-${crypto.randomUUID()}`;
  const response = await runFilesOp(
    gatedEnv(env),
    requestId,
    {
      op: spec.op,
      params: spec.params,
      version: FILES_PROTOCOL_VERSION,
    },
    env.FILES_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN
  );
  const envelope = (await response
    .json()
    .catch(() => null)) as FilesEnvelope<T> | null;
  if (response.ok && envelope?.ok) {
    return { data: envelope.data, kind: "ok" };
  }
  const code = envelope && !envelope.ok ? envelope.error.code : "INTERNAL";
  if (
    code === "NOT_FOUND" ||
    code === "PAYLOAD_TOO_LARGE" ||
    code === "UNSUPPORTED" ||
    spec.fallbackCodes?.includes(code)
  ) {
    return {
      code,
      kind: "fallback",
      message:
        envelope && !envelope.ok
          ? String(envelope.error.message).slice(0, 200)
          : code,
    };
  }
  if (code === "AI_CAPACITY" || code === "AI_INVALID_OUTPUT") {
    const error = new Error(
      code === "AI_CAPACITY"
        ? "files_worker_ai: rate limit reached 429"
        : "files_worker_ai: failed to validate JSON"
    );
    const facts =
      envelope && !envelope.ok
        ? readFilesAiGenerationFacts(envelope.error.aiFacts)
        : null;
    throw Object.assign(error, facts ? { aiFacts: facts } : {});
  }
  throw new Error(
    `files_worker_error:${code}:${String(response.status)}:${requestId}`
  );
};
