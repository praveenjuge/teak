import {
  FILES_PROTOCOL_VERSION,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesOp,
  FilesOpError,
  type FilesOpOutcome,
  readFilesOpOutcome,
} from "@teak/files-protocol";
import { gatedEnv } from "../deletionGate";
import { type FilesOpsEnv, runFilesOp } from "../ops";

const DEFAULT_PUBLIC_ORIGIN = "https://files.teakvault.com";

/**
 * Runs an op in process, as the network route would, and reads its answer
 * the way Convex does (`readFilesOpOutcome`).
 */
export const callFilesOp = async <T>(
  env: FilesOpsEnv,
  spec: {
    declineCodes?: readonly FilesErrorCode[];
    op: FilesOp;
    params: Record<string, unknown>;
  }
): Promise<FilesOpOutcome<T>> => {
  const { envelope, status } = await runFilesOp(
    gatedEnv(env),
    `wf-${crypto.randomUUID()}`,
    { op: spec.op, params: spec.params, version: FILES_PROTOCOL_VERSION },
    env.FILES_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN
  );
  return readFilesOpOutcome(
    envelope as FilesEnvelope<T>,
    status,
    spec.declineCodes
  );
};

/** The op said another try may work; known only inside the calling step. */
export const isRetryableFilesError = (error: unknown): boolean =>
  error instanceof FilesOpError && error.retryable;
