import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AccountState {
  apiKey?: string;
  deleted?: boolean;
  email: string;
  passwordReset?: boolean;
}

export interface RunState {
  accounts: AccountState[];
  createdCardIds: string[];
  primary?: AccountState;
  revokedKey?: string;
}

const file = new URL("../../.state/run-state.json", import.meta.url);
export const storageStateFile = ".state/user.json";

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
