/**
 * Bounded subprocess runner for repo scripts.
 *
 * Kills the child on timeout and cancels its pipes: without cancellation a
 * killed child's grandchildren can hold stdout/stderr open and hang readers
 * forever. Timeouts resolve (never throw) with exit code 1 and the timeout
 * recorded on stderr so existing tail-extraction surfaces it. Spawn
 * failures propagate to the caller.
 */

export interface RunCommandResult {
  exitCode: number;
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
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(9);
    } catch {
      // Already exited; reader cancellation below still releases.
    }
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
        stderr: stderr ? `${stderr}\n${note}` : note,
        stdout,
        timedOut,
      };
    }
    return { exitCode: exitCode ?? 1, stderr, stdout, timedOut };
  } catch {
    return {
      exitCode: 1,
      stderr: timedOut ? `command timed out after ${timeoutMs}ms` : "",
      stdout: "",
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};
