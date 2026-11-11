import {
  FILES_PROTOCOL_VERSION,
  type FilesErrorCode,
  type FilesNetworkOp,
  FilesOpError,
  signFilesOpRequest,
} from "@teak/files-protocol";
import type { FilesOp } from "../opSpecs";
import { answerResponse, type FilesOpsEnv, runFilesOp } from "../ops";

export const TEST_SECRET = "test-secret";
export const TEST_ORIGIN = "https://files.teakvault.com";

export interface OpTestResult {
  body: {
    data?: any;
    error?: {
      aiFacts?: unknown;
      code: FilesErrorCode;
      message: string;
      requestId: string;
      retryable: boolean;
    };
    ok: boolean;
  };
  status: number;
}

/** Runs an op in process, the way the Worker's workflows and queues do. */
export const runOp = async (
  env: Partial<FilesOpsEnv>,
  op: FilesOp | (string & {}),
  params: Record<string, unknown>,
  origin = TEST_ORIGIN
): Promise<OpTestResult> => {
  const { envelope, status } = await runFilesOp(
    { FILES_SIGNING_SECRET: TEST_SECRET, ...env } as FilesOpsEnv,
    crypto.randomUUID(),
    { op: op as FilesOp, params, version: FILES_PROTOCOL_VERSION },
    origin
  );
  return { body: envelope as OpTestResult["body"], status };
};

/** A request to the network op route, signed the way Convex signs it. */
export const signedOpRequest = async (
  op: FilesNetworkOp | (string & {}),
  params: Record<string, unknown>,
  { origin = TEST_ORIGIN, secret = TEST_SECRET } = {}
): Promise<Request> => {
  const signed = await signFilesOpRequest({
    base: origin,
    op: op as FilesNetworkOp,
    params,
    secret,
  });
  return new Request(signed.url, {
    body: signed.body,
    headers: signed.headers,
    method: signed.method,
  });
};

/** An op for `handleOp`: the Worker-internal ops have no network route. */
export interface OpCall {
  op: FilesOp | (string & {});
  params: unknown;
}

export const opCall = (op: OpCall["op"], params: unknown): OpCall => ({
  op,
  params,
});

/** Runs an op in process and answers as the network route would. */
export const handleOp = async (
  call: OpCall | Promise<OpCall>,
  env: FilesOpsEnv
): Promise<Response> => {
  const { op, params } = await call;
  return answerResponse(
    await runFilesOp(
      env,
      crypto.randomUUID(),
      { op: op as FilesOp, params, version: FILES_PROTOCOL_VERSION },
      TEST_ORIGIN
    )
  );
};

/** An op failure as `readFilesOpOutcome` throws it. */
export const opError = (
  code: FilesErrorCode,
  { retryable = false, status = 500 } = {}
): FilesOpError =>
  new FilesOpError({ code, requestId: "test", retryable, status });
