import {
  WORKFLOW_RPC_ERROR_CODES,
  type WorkflowRpcErrorCode,
} from "@teak/files-protocol";
import { errorMessage } from "../errors";

// A NonRetryableError thrown inside a step reaches the workflow as a plain
// Error whose message starts with "NonRetryableError: " (engine.test.ts).
const ERROR_NAME_PREFIX = /^[A-Za-z]*Error:\s*/u;

const messageOf = (error: unknown): string =>
  errorMessage(error).replace(ERROR_NAME_PREFIX, "");

/**
 * Why Convex refused a guarded write (`convexRpc` throws the code first in
 * the message): the card is gone, or newer work replaced the run. Null for
 * any other error.
 */
export const supersededReason = (
  error: unknown
): WorkflowRpcErrorCode | null => {
  const message = messageOf(error);
  return (
    WORKFLOW_RPC_ERROR_CODES.find((code) => message.startsWith(code)) ?? null
  );
};

export const isSuperseded = (error: unknown): boolean =>
  supersededReason(error) !== null;

/** For a step whose failure is otherwise kept: a superseded run still ends. */
export const rethrowSuperseded = (error: unknown): void => {
  if (isSuperseded(error)) {
    throw error;
  }
};

/**
 * Only an error's message crosses a step, so a step that wants its caller or
 * its retry `delay` to know more puts the facts in the message as JSON.
 */
export const encodeStepError = (prefix: string, facts: object): Error =>
  new Error(`${prefix}${JSON.stringify(facts)}`);

export const decodeStepError = <T extends { type: string }>(
  prefix: string,
  error: unknown
): T | null => {
  const message = messageOf(error);
  if (!message.startsWith(prefix)) {
    return null;
  }
  try {
    const facts = JSON.parse(message.slice(prefix.length)) as T | null;
    return facts && typeof facts.type === "string" ? facts : null;
  } catch {
    return null;
  }
};
