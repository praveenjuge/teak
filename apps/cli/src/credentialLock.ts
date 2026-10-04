import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

interface Owner {
  nonce: string;
  pid: number;
}
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const uncertain = () =>
  new Error(
    "Credential lock ownership is uncertain; inspect the lock before retrying."
  );

function inspect(path: string, directory: boolean) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (process.platform !== "win32" &&
      (stat.mode % 0o100 !== 0 || stat.uid !== process.getuid?.())) ||
    (!directory && (stat.nlink !== 1 || stat.size > 1024))
  ) {
    throw new Error("Unsafe credential lock.");
  }
  return stat;
}
function ownerAt(path: string): Owner {
  inspect(join(path, "owner.json"), false);
  const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
  if (
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.nonce !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.nonce)
  ) {
    throw uncertain();
  }
  return value;
}
function dead(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (code(error) === "ESRCH") {
      return true;
    }
    if (code(error) === "EPERM") {
      return false;
    }
    throw uncertain();
  }
}
function sameOwner(a: Owner, b: Owner) {
  return a.pid === b.pid && a.nonce === b.nonce;
}
function sameDirectory(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino;
}

// A caller supplies a trusted local path derived from account identity, never
// tokens. Interactive login stays outside this bounded storage critical section.
export async function withCredentialLock<T>(
  path: string,
  work: () => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("Invalid credential lock timeout.");
  }
  const deadline = performance.now() + timeoutMs;
  const owner: Owner = { pid: process.pid, nonce: randomUUID() };
  let acquired: Stats;
  for (;;) {
    try {
      mkdirSync(path, { mode: 0o700 });
      acquired = inspect(path, true);
      writeFileSync(join(path, "owner.json"), JSON.stringify(owner), {
        flag: "wx",
        mode: 0o600,
      });
      break;
    } catch (error) {
      if (code(error) !== "EEXIST") {
        throw error;
      }
    }
    if (performance.now() >= deadline) {
      throw new Error(
        "Timed out waiting for credential lock; inspect uncertain ownership before retrying."
      );
    }
    try {
      const before = inspect(path, true);
      const previous = ownerAt(path);
      if (dead(previous.pid)) {
        const marker = join(path, "reclaim.json");
        try {
          writeFileSync(marker, JSON.stringify(owner), {
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          if (code(error) !== "EEXIST" && code(error) !== "ENOENT") {
            throw error;
          }
          if (performance.now() >= deadline) {
            throw uncertain();
          }
          await setTimeout(25);
          continue;
        }
        if (
          !(
            sameDirectory(before, inspect(path, true)) &&
            sameOwner(previous, ownerAt(path)) &&
            dead(previous.pid)
          )
        ) {
          throw uncertain();
        }
        unlinkSync(join(path, "owner.json"));
        unlinkSync(marker);
        rmdirSync(path);
        continue;
      }
    } catch (error) {
      // A creator can be between mkdir and owner publication, or a dead-owner
      // reclaim can be finishing. Never infer death from missing metadata.
      if (code(error) !== "ENOENT") {
        throw error;
      }
    }
    if (performance.now() >= deadline) {
      throw new Error(
        "Timed out waiting for credential lock; inspect uncertain ownership before retrying."
      );
    }
    await setTimeout(25);
  }
  const release = () => {
    if (
      !(
        sameDirectory(acquired, inspect(path, true)) &&
        sameOwner(owner, ownerAt(path))
      )
    ) {
      throw uncertain();
    }
    unlinkSync(join(path, "owner.json"));
    rmdirSync(path);
  };
  try {
    return await work();
  } finally {
    release();
  }
}
