import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isInteractive } from "./mode";
import { configDir, readJson, VERSION } from "./runtime";

// Once a day at most, a person at a terminal hears that a newer teak-cli is
// out. The check asks the npm registry for the latest version and sends
// nothing else; it never installs anything, and it stays quiet in JSON, a
// pipe, CI and an agent's shell, or with TEAK_NO_UPDATE_CHECK set.

const DAY_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/teak-cli/latest";
const CHECK_TIMEOUT_MS = 1500;

export interface UpdateState {
  checkedAt?: number;
  latest?: string;
  notifiedAt?: number;
}

const parts = (version: string) =>
  version
    .split("-")[0]
    ?.split(".")
    .map((part) => Number.parseInt(part, 10) || 0) ?? [];

/** Whether `candidate` is a later release than `current`, by major.minor.patch. */
export const isNewer = (candidate: string, current: string) => {
  const next = parts(candidate);
  const now = parts(current);
  for (let index = 0; index < 3; index += 1) {
    const difference = (next[index] ?? 0) - (now[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
};

/**
 * One update check: asks for the latest version when the last answer is a day
 * old, and words a notice when it's newer and none was shown today.
 */
export const checkForUpdate = async (input: {
  current: string;
  fetchLatest: () => Promise<string | undefined>;
  now: number;
  state: UpdateState;
}) => {
  const state = { ...input.state };
  if (!state.checkedAt || input.now - state.checkedAt >= DAY_MS) {
    // Recorded even when the registry can't be reached, so an offline
    // machine doesn't wait on it every run.
    state.checkedAt = input.now;
    state.latest =
      (await input.fetchLatest().catch(() => undefined)) ?? state.latest;
  }
  const due = !state.notifiedAt || input.now - state.notifiedAt >= DAY_MS;
  if (!(state.latest && due && isNewer(state.latest, input.current))) {
    return { state };
  }
  state.notifiedAt = input.now;
  return {
    notice: `teak-cli ${state.latest} is out (you have ${input.current}). Update with: npm install -g teak-cli@latest`,
    state,
  };
};

const statePath = () => path.join(configDir(), "update-check.json");

const readState = (): UpdateState => {
  try {
    return readJson<UpdateState>(readFileSync(statePath(), "utf8")) ?? {};
  } catch {
    return {};
  }
};

const writeState = (state: UpdateState) => {
  const target = statePath();
  const temporary = `${target}.${process.pid}.part`;
  try {
    mkdirSync(path.dirname(target), { mode: 0o700, recursive: true });
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    renameSync(temporary, target);
  } catch {
    rmSync(temporary, { force: true });
  }
};

const fetchLatest = async () => {
  const response = await fetch(REGISTRY_URL, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) {
    return;
  }
  const { version } = (await response.json()) as { version?: unknown };
  return typeof version === "string" ? version : undefined;
};

const isSet = (value: string | undefined) =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

/**
 * Starts the day's check beside the command, when one is due and someone will
 * read it; resolves to the notice to print once the command is done.
 */
export const startUpdateCheck = (json: boolean) => {
  if (
    json ||
    !isInteractive() ||
    isSet(process.env.TEAK_NO_UPDATE_CHECK) ||
    VERSION === "0.0.0"
  ) {
    return Promise.resolve(undefined);
  }
  return checkForUpdate({
    current: VERSION,
    fetchLatest,
    now: Date.now(),
    state: readState(),
  })
    .then(({ notice, state }) => {
      writeState(state);
      return notice;
    })
    .catch(() => undefined);
};
