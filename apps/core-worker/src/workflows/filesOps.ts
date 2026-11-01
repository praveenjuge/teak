import {
  FILES_PROTOCOL_VERSION,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesOp,
  readFilesAiGenerationFacts,
} from "@teak/files-protocol";
import { gatedBucket } from "../deletionGate";
import { type FilesOpsEnv, runFilesOp } from "../ops";
import { retryingReads } from "../storage/r2Retry";

/**
 * An op that neither succeeds nor declines throws, so step retries apply.
 * An error that leaves `step.do` keeps its name and message but not its
 * class, so the code travels in the message:
 * `files_worker_ai: rate limit reached 429`,
 * `files_worker_ai: failed to validate JSON`, or
 * `files_worker_error:<CODE>:<status>:<requestId>`.
 */
export type FilesOpOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "fallback"; code: FilesErrorCode; message: string };

const DEFAULT_PUBLIC_ORIGIN = "https://files.teakvault.com";

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
  // The flag survives only inside the step that called the op.
  throw Object.assign(
    new Error(
      `files_worker_error:${code}:${String(response.status)}:${requestId}`
    ),
    { retryable: envelope && !envelope.ok ? envelope.error.retryable : true }
  );
};

export const isRetryableFilesError = (error: unknown): boolean =>
  error instanceof Error &&
  (error as Error & { retryable?: boolean }).retryable === true;
