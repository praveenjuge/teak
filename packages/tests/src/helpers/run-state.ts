import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

const file = new URL("../../.state/run-state.json", import.meta.url);
export const accountStorageStateFile = ".state/account.json";
export const importExportStorageStateFile = ".state/import-export.json";
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

export const writeState = (next: RunState) => {
  mkdirSync(dirname(file.pathname), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
};

export const updateState = (fn: (state: RunState) => void) => {
  const state = readState();
  fn(state);
  writeState(state);
  return state;
};

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
