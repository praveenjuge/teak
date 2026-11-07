// The one place that decides how the CLI behaves for whoever runs it. Other
// modules ask these questions instead of reading isTTY or CI themselves.

// Set by coding agents that run shell commands. A prompt an agent can't see
// would hang it, and a browser it opens lands on someone else's screen.
const AGENT_VARIABLES = [
  "AI_AGENT",
  "CLAUDECODE",
  "CODEX_SANDBOX",
  "CURSOR_AGENT",
  "GEMINI_CLI",
];

export interface ModeInput {
  env: Record<string, string | undefined>;
  stderrTTY: boolean;
  stdinTTY: boolean;
  stdoutTTY: boolean;
}

const current = (): ModeInput => ({
  env: process.env,
  stderrTTY: process.stderr.isTTY === true,
  stdinTTY: process.stdin.isTTY === true,
  stdoutTTY: process.stdout.isTTY === true,
});

const isSet = (value: string | undefined) =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

export const isAgent = (input: ModeInput = current()) =>
  AGENT_VARIABLES.some((name) => isSet(input.env[name]));

export const isCI = (input: ModeInput = current()) => isSet(input.env.CI);

const unattended = (input: ModeInput) => isAgent(input) || isCI(input);

/** Someone can answer a (y/N) question. */
export const canPrompt = (input: ModeInput = current()) =>
  input.stdinTTY && input.stderrTTY && !unattended(input);

/** A person is at the terminal: open a browser, show tips. */
export const isInteractive = (input: ModeInput = current()) =>
  input.stdoutTTY && input.stderrTTY && !unattended(input);

/** Redraw a progress line on stderr. */
export const showsProgress = (input: ModeInput = current()) =>
  input.stderrTTY && !unattended(input);

/** stdout goes to a pipe or a file: print tab-separated fields, in full. */
export const plainOutput = (input: ModeInput = current()) => !input.stdoutTTY;

/** Mark errors (✗) and warnings (!) for a person reading stderr. */
export const marksStderr = (input: ModeInput = current()) =>
  input.stderrTTY && !unattended(input);
