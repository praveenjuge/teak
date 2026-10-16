import type { ToolCommand } from "./args";

export const ADDRESS_SPACE_BYTES = 1_073_741_824;
export const MAX_OPEN_FILES = 64;
const DEFAULT_MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export function limitedCommand(
  argv: string[],
  cpuSeconds: number,
  platform: string = process.platform
): string[] {
  if (platform !== "linux") {
    return argv;
  }
  return [
    "prlimit",
    `--as=${ADDRESS_SPACE_BYTES}`,
    `--cpu=${Math.max(1, Math.ceil(cpuSeconds))}`,
    `--nofile=${MAX_OPEN_FILES}`,
    "--core=0",
    "--",
    ...argv,
  ];
}

export type StdoutHandling =
  | { kind: "buffer"; maxBytes: number; stopAtLimit: boolean }
  | { kind: "stream"; onChunk: (chunk: Uint8Array) => void };

export interface RunOptions {
  deadlineEpochMs: number;
  stdout?: StdoutHandling;
}

export interface RunResult {
  exitCode: number | null;
  stderr: string;
  stdout: Uint8Array;
  stdoutTruncated: boolean;
  timedOut: boolean;
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (kept >= limit) {
      if (!truncated) {
        truncated = true;
        onOverflow();
      }
      continue;
    }
    const take = Math.min(chunk.byteLength, limit - kept);
    chunks.push(take === chunk.byteLength ? chunk : chunk.subarray(0, take));
    kept += take;
    if (take < chunk.byteLength && !truncated) {
      truncated = true;
      onOverflow();
    }
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

async function forward(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void
): Promise<void> {
  for await (const chunk of stream) {
    onChunk(chunk);
  }
}

export async function run(
  argv: ToolCommand,
  options: RunOptions
): Promise<RunResult> {
  const remaining = options.deadlineEpochMs - Date.now();
  if (remaining <= 0) {
    return {
      exitCode: null,
      stdout: new Uint8Array(),
      stderr: "",
      timedOut: true,
      stdoutTruncated: false,
    };
  }
  const command = limitedCommand(argv, remaining / 1000);
  const child = Bun.spawn(command, {
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid);
  }, remaining);

  const stdout = options.stdout ?? {
    kind: "buffer",
    maxBytes: DEFAULT_MAX_STDOUT_BYTES,
    stopAtLimit: false,
  };
  const stdoutTask =
    stdout.kind === "stream"
      ? forward(child.stdout, stdout.onChunk).then(() => ({
          bytes: new Uint8Array(),
          truncated: false,
        }))
      : readBounded(child.stdout, stdout.maxBytes, () => {
          if (stdout.stopAtLimit) {
            killGroup(child.pid);
          }
        });
  const stderrTask = readBounded(child.stderr, MAX_STDERR_BYTES, () => {
    // Keep draining so the child never blocks on a full pipe.
  });

  try {
    const [stdoutRead, stderrRead, exitCode] = await Promise.all([
      stdoutTask,
      stderrTask,
      child.exited,
    ]);
    return {
      exitCode: timedOut || child.signalCode ? null : exitCode,
      stdout: stdoutRead.bytes,
      stderr: new TextDecoder().decode(stderrRead.bytes),
      timedOut,
      stdoutTruncated: stdoutRead.truncated,
    };
  } finally {
    clearTimeout(timer);
    killGroup(child.pid);
  }
}
