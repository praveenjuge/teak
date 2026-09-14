/**
 * Bounded subprocess runner for repo scripts.
 *
 * The child runs detached in its own process group so a timeout terminates
 * the whole tree: killing only the direct child would orphan descendants
 * that keep mutating state and holding resources. Readers are cancelled too
 * so a killed tree cannot hang output collection. Timeouts resolve (never
 * throw) with a nonzero exit and the timeout recorded on stderr so existing
 * tail-extraction surfaces it. Spawn failures propagate to the caller.
 */

export interface RunCommandResult {
  exitCode: number;
  pid: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> => {
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

export const runCommand = async (
  command: string[],
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<RunCommandResult> => {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const proc = Bun.spawn(command, {
    cwd: opts?.cwd,
    detached: true,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  const killTree = () => {
    try {
      process.kill(-proc.pid, 9);
    } catch {
      // Group already gone (or negative pids unsupported); fall through to
      // the direct kill below.
    }
    try {
      proc.kill(9);
    } catch {
      // Already exited; reader cancellation below still releases.
    }
  };
  // A detached child leaves our process group, so terminal and CI signals
  // no longer reach it. Forward them to the tree, then re-raise with
  // default handling so exit codes stay standard.
  const forwardSignal = (signal: "SIGINT" | "SIGTERM", own: () => void) => {
    killTree();
    process.removeListener(signal, own);
    try {
      process.kill(process.pid, signal);
    } catch {
      // Already exiting.
    }
  };
  const onSigint = () => forwardSignal("SIGINT", onSigint);
  const onSigterm = () => forwardSignal("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
    stdoutReader.cancel().catch(() => {});
    stderrReader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(stdoutReader),
      readStream(stderrReader),
      proc.exited,
    ]);
    if (timedOut) {
      const note = `command timed out after ${timeoutMs}ms`;
      return {
        exitCode: exitCode ?? 1,
        pid: proc.pid,
        stderr: stderr ? `${stderr}\n${note}` : note,
        stdout,
        timedOut,
      };
    }
    return { exitCode: exitCode ?? 1, pid: proc.pid, stderr, stdout, timedOut };
  } catch {
    return {
      exitCode: 1,
      pid: proc.pid,
      stderr: timedOut ? `command timed out after ${timeoutMs}ms` : "",
      stdout: "",
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
};
