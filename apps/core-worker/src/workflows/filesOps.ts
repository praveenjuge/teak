import {
  FILES_PROTOCOL_VERSION,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesOp,
  FilesOpError,
  type FilesOpOutcome,
  type FilesOpParams,
  type FilesOpResult,
  readFilesOpOutcome,
} from "@teak/files-protocol";
import { gatedEnv } from "../deletionGate";
import { type FilesOpsEnv, runFilesOp } from "../ops";

/** One op call: the op, its params, and the codes the caller takes as a no. */
export interface FilesOpCall<Op extends FilesOp> {
  declineCodes?: readonly FilesErrorCode[];
  op: Op;
  params: FilesOpParams<Op>;
}

/** Calls an op, typed by its entry in `FILES_OP_SPECS`. */
export type OpCaller = <Op extends FilesOp>(
  spec: FilesOpCall<Op>
) => Promise<FilesOpOutcome<FilesOpResult<Op>>>;

/**
 * Runs an op in process, as the network route would, and reads its answer
 * the way Convex does (`readFilesOpOutcome`). Its writes go through the
 * deletion gate: the Worker's entry points gate the env once, and `gatedEnv`
 * returns that env unchanged, so this covers only a caller that built its
 * own env (tests that drive a workflow's functions). The Worker's own origin is FILES_PUBLIC_ORIGIN; without it an op
 * that signs image URLs fails rather than sign them for another deployment.
 */
export const callFilesOp = async <Op extends FilesOp>(
  env: FilesOpsEnv,
  spec: FilesOpCall<Op>
): Promise<FilesOpOutcome<FilesOpResult<Op>>> => {
  const { envelope, status } = await runFilesOp(
    gatedEnv(env),
    `wf-${crypto.randomUUID()}`,
    { op: spec.op, params: spec.params, version: FILES_PROTOCOL_VERSION },
    env.FILES_PUBLIC_ORIGIN
  );
  return readFilesOpOutcome(
    envelope as FilesEnvelope<never>,
    status,
    spec.declineCodes
  );
};

/** The op said another try may work; known only inside the calling step. */
export const isRetryableFilesError = (error: unknown): boolean =>
  error instanceof FilesOpError && error.retryable;
