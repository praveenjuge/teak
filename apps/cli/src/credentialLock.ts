import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
  // lstat can resolve a file just before a concurrent unlink (an owner
  // releasing) and then report the inode with no links left. The path is gone,
  // so report it as missing and let callers retry; hard links stay unsafe.
  if (!directory && stat.nlink === 0) {
    throw Object.assign(new Error(`Credential lock entry vanished: ${path}`), {
      code: "ENOENT",
    });
  }
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
const isTransientMissing = (error: unknown) => code(error) === "ENOENT";

declare const lockPathBrand: unique symbol;
export type CredentialLockPath = string & { [lockPathBrand]: true };
export const credentialLockPath = (directory: string, account: string) =>
  join(directory, `credentials-${account}.lock`) as CredentialLockPath;

function publishOwner(path: CredentialLockPath, owner: Owner) {
  const temporary = join(path, `owner-${owner.nonce}.tmp`);
  writeFileSync(temporary, JSON.stringify(owner), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, join(path, "owner.json"));
}

async function tryReclaimDeadOwner(
  path: CredentialLockPath,
  before: Stats,
  previous: Owner,
  owner: Owner,
  deadline: number
) {
  const marker = `${path}.reclaim-${previous.nonce}`;
  try {
    lstatSync(join(path, "reclaim.json"));
    throw uncertain();
  } catch (error) {
    if (code(error) !== "ENOENT") {
      throw error;
    }
  }
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
    return;
  }
  const claimStat = inspect(marker, false);
  const releaseClaim = () => {
    if (!sameDirectory(claimStat, inspect(marker, false))) {
      throw uncertain();
    }
    const claim = JSON.parse(readFileSync(marker, "utf8")) as Owner;
    if (!sameOwner(owner, claim)) {
      throw uncertain();
    }
    unlinkSync(marker);
  };
  try {
    if (
      sameDirectory(before, inspect(path, true)) &&
      sameOwner(previous, ownerAt(path)) &&
      dead(previous.pid)
    ) {
      unlinkSync(join(path, "owner.json"));
      rmdirSync(path);
    }
  } finally {
    releaseClaim();
  }
}

export async function withCredentialLock<T>(
  path: CredentialLockPath,
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
      publishOwner(path, owner);
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
        await tryReclaimDeadOwner(path, before, previous, owner, deadline);
        continue;
      }
    } catch (error) {
      if (!isTransientMissing(error)) {
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
