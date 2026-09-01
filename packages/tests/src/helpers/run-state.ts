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
  deleted?: boolean;
  email: string;
  passwordReset?: boolean;
}

export interface RunState {
  account?: AccountState;
  accounts: AccountState[];
  createdCardIds: string[];
  importExport?: AccountState;
  primary?: AccountState;
  revokedKey?: string;
  serviceAccounts?: Partial<Record<ServiceAccountSurface, AccountState>>;
  webCore?: AccountState;
  webFiles?: AccountState;
  webFilters?: AccountState;
  webSurfaces?: AccountState;
}

export type ServiceAccountSurface = "api" | "cli" | "mcp";

const file = process.env.TEAK_E2E_RUN_STATE_FILE
  ? pathToFileURL(resolve(process.env.TEAK_E2E_RUN_STATE_FILE))
  : new URL("../../.state/run-state.json", import.meta.url);
const lockDirectory = new URL("run-state.lock/", file);
const lockWaitArray = new Int32Array(new SharedArrayBuffer(4));
const LOCK_TIMEOUT_MS = 5000;
export const accountStorageStateFile = ".state/account.json";
export const importExportStorageStateFile = ".state/import-export.json";
export const securityStorageStateFile = ".state/security.json";
export const storageStateFile = ".state/user.json";
export const webCoreStorageStateFile = ".state/web-core.json";
export const webFilesStorageStateFile = ".state/web-files.json";
export const webFiltersStorageStateFile = ".state/web-filters.json";
export const webSurfacesStorageStateFile = ".state/web-surfaces.json";

export const readState = (): RunState => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RunState;
  } catch {
    return { accounts: [], createdCardIds: [] };
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
        throw new Error("Timed out waiting for the production E2E state lock");
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

export const requireAccount = (
  key:
    | "primary"
    | "webCore"
    | "webSurfaces"
    | "webFiles"
    | "webFilters"
    | "account"
    | "importExport"
): AccountState => {
  const account = readState()[key];
  if (!account?.email) {
    throw new Error(`Missing ${key} account`);
  }
  return account;
};

export const requireAccountApiKey = (
  key:
    | "primary"
    | "webCore"
    | "webSurfaces"
    | "webFiles"
    | "webFilters"
    | "account"
    | "importExport"
): string => {
  const apiKey = readState()[key]?.apiKey;
  if (!apiKey) {
    throw new Error(`Missing ${key} account API key`);
  }
  return apiKey;
};

export const rememberAccount = (account: AccountState, primary = false) =>
  updateState((state) => {
    const index = state.accounts.findIndex(
      (item) => item.email === account.email
    );
    if (index >= 0) {
      state.accounts[index] = { ...state.accounts[index], ...account };
    } else {
      state.accounts.push(account);
    }
    if (primary) {
      state.primary = { ...(state.primary ?? account), ...account };
    }
  });
