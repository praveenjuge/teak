// Runs one tool process with hard limits. On Linux every process runs under
// prlimit (address space, CPU seconds, open files, no core dumps). On every
// platform it runs in its own process group, and the wall-clock timer kills
// the whole group so nothing it forked survives the job.

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

export interface RunOptions {
  /** Absolute epoch milliseconds after which the process group is killed. */
  deadline: number;
  /** Bytes of stdout to keep (default 4 MiB). Ignored when `onStdout` is set. */
  maxStdoutBytes?: number;
  /** Stream stdout to this callback instead of buffering it. */
  onStdout?: (chunk: Uint8Array) => void;
  /** Kill the process once stdout passes `maxStdoutBytes`. */
  stopAtStdoutLimit?: boolean;
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
  } catch {
    // The group is already gone.
  }
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
  argv: string[],
  options: RunOptions
): Promise<RunResult> {
  const remaining = options.deadline - Date.now();
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

  const stopOnOverflow = () => {
    if (options.stopAtStdoutLimit) {
      killGroup(child.pid);
    }
  };
  const stdoutTask = options.onStdout
    ? forward(child.stdout, options.onStdout).then(() => ({
        bytes: new Uint8Array(),
        truncated: false,
      }))
    : readBounded(
        child.stdout,
        options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES,
        stopOnOverflow
      );
  const stderrTask = readBounded(child.stderr, MAX_STDERR_BYTES, () => {
    // Keep draining so the child never blocks on a full pipe.
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutTask,
      stderrTask,
      child.exited,
    ]);
    return {
      exitCode: timedOut || child.signalCode ? null : exitCode,
      stdout: stdout.bytes,
      stderr: new TextDecoder().decode(stderr.bytes),
      timedOut,
      stdoutTruncated: stdout.truncated,
    };
  } finally {
    clearTimeout(timer);
    // Anything the tool forked and left behind goes with it.
    killGroup(child.pid);
  }
}
