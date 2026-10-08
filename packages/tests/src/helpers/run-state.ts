import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface AccountState {
  apiKey?: string;
  email: string;
  password?: string;
}

export interface RunState {
  account?: AccountState;
  createdCardIds: string[];
  primary?: AccountState;
  revokedKey?: string;
  security?: AccountState;
  serviceAccounts?: Partial<Record<ServiceAccountSurface, AccountState>>;
  webCore?: AccountState;
  webFilters?: AccountState;
  webSurfaces?: AccountState;
}

export type AccountKey =
  | "account"
  | "primary"
  | "security"
  | "webCore"
  | "webFilters"
  | "webSurfaces";

export type ServiceAccountSurface = "api" | "cli" | "mcp";

const file = process.env.TEAK_E2E_RUN_STATE_FILE
  ? pathToFileURL(resolve(process.env.TEAK_E2E_RUN_STATE_FILE))
  : new URL("../../.state/run-state.json", import.meta.url);
const lockDirectory = new URL("run-state.lock/", file);
const lockWaitArray = new Int32Array(new SharedArrayBuffer(4));
const LOCK_TIMEOUT_MS = 5000;
export const readState = (): RunState => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RunState;
  } catch {
    return { createdCardIds: [] };
  }
};

const writeStateUnlocked = (next: RunState) => {
  mkdirSync(dirname(file.pathname), { recursive: true });
  const temporaryFile = new URL(
    `run-state.${process.pid}.${randomUUID()}.tmp`,
    file
  );
  writeFileSync(temporaryFile, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporaryFile, file);
};

const withStateLock = <T>(operation: () => T): T => {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  mkdirSync(dirname(file.pathname), { recursive: true });
  while (true) {
    try {
      mkdirSync(lockDirectory);
      break;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the E2E state lock");
      }
      Atomics.wait(lockWaitArray, 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    rmdirSync(lockDirectory);
  }
};

export const writeState = (next: RunState) =>
  withStateLock(() => writeStateUnlocked(next));

export const updateState = (fn: (state: RunState) => void) =>
  withStateLock(() => {
    const state = readState();
    fn(state);
    writeStateUnlocked(state);
    return state;
  });

export const requireServiceApiKey = (
  surface: ServiceAccountSurface
): string => {
  const apiKey = readState().serviceAccounts?.[surface]?.apiKey;
  if (!apiKey) {
    throw new Error(`Missing ${surface} service account API key`);
  }
  return apiKey;
};

export const requireAccount = (key: AccountKey): AccountState => {
  const account = readState()[key];
  if (!account?.email) {
    throw new Error(`Missing ${key} account`);
  }
  return account;
};
