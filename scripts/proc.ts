/**
 * Bounded subprocess runner for repo scripts.
 *
 * The child runs detached in its own process group so a timeout terminates
 * the whole tree: killing only the direct child would orphan descendants
 * that keep mutating state and holding resources. Readers are cancelled too
 * so a killed tree cannot hang output collection. Timeouts resolve (never
 * throw) with a nonzero exit and the timeout recorded on stderr so existing
 * tail-extraction surfaces it. Spawn failures propagate to the caller.
 *
 * A normal exit ends the tree too. The Convex CLI signals the local backend
 * it started and exits without waiting, so a backend that does not stop
 * keeps the fixed port bound and the next `convex dev` refuses to start.
 * Only the process group created here is signalled, so a process some other
 * command started is never touched.
 */

// Matches the window `convex dev` gives a previous backend to stop.
const GROUP_EXIT_GRACE_MS = 5000;

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForGroupExit = async (pgid: number, ms: number): Promise<void> => {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid) && Date.now() < deadline) {
    await Bun.sleep(100);
  }
};

const settleGroup = async (pgid: number): Promise<void> => {
  if (!groupAlive(pgid)) {
    return;
  }
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  await waitForGroupExit(pgid, GROUP_EXIT_GRACE_MS);
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // The group exited within the grace period.
    return;
  }
  await waitForGroupExit(pgid, 1000);
};

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
  opts?: { cwd?: string; stdin?: string; timeoutMs?: number }
): Promise<RunCommandResult> => {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const proc = Bun.spawn(command, {
    cwd: opts?.cwd,
    detached: true,
    stderr: "pipe",
    // Secrets go through stdin so they never appear in the process list.
    stdin: opts?.stdin === undefined ? "ignore" : Buffer.from(opts.stdin),
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
  // Settle the group as soon as the command exits, not after output EOF: a
  // leftover descendant holding an inherited pipe would otherwise keep the
  // readers waiting until the timeout.
  const exited = proc.exited.then(async (code) => {
    if (!timedOut) {
      await settleGroup(proc.pid);
    }
    return code;
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(stdoutReader),
      readStream(stderrReader),
      exited,
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
