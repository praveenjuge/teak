import { afterAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCredentialLock } from "./credentialLock";

const base = mkdtempSync(join(tmpdir(), "teak-lock-test-"));
const modulePath = new URL("./credentialLock.ts", import.meta.url).pathname;
afterAll(() => rmSync(base, { recursive: true, force: true }));
let count = 0;
function fixture() {
  return join(base, `lock-${count++}`);
}
function child(path: string, body: string, journal = "") {
  return Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `
    const {withCredentialLock} = await import(process.argv[1]);
    import {appendFileSync} from "node:fs";
    const path = process.argv[2]; const journal = process.argv[3];
    await withCredentialLock(path, async () => { ${body} });
  `,
      modulePath,
      path,
      journal,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
}
async function successful(process: ReturnType<typeof child>) {
  const [status, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
}

// Failure modes: competing processes overlap, thrown work leaves a lock,
// crashed/live/unknown owners are confused, unsafe paths are followed, and a
// former owner releases a replacement's lock. Processes exercise real PID and
// filesystem semantics; no mocked sibling or fake process-liveness boundary.
test("separate processes serialize critical sections with private metadata", async () => {
  const path = fixture();
  const journal = join(base, "journal");
  const work = `appendFileSync(journal, "start\\n");
    await Bun.sleep(80); appendFileSync(journal, "end\\n");`;
  await Promise.all([
    successful(child(path, work, journal)),
    successful(child(path, work, journal)),
    successful(child(path, work, journal)),
  ]);
  expect(readFileSync(journal, "utf8")).toBe(
    "start\nend\nstart\nend\nstart\nend\n"
  );
  await withCredentialLock(path, () => {
    if (process.platform !== "win32") {
      expect(statSync(path).mode % 0o1000).toBe(0o700);
      expect(statSync(join(path, "owner.json")).mode % 0o1000).toBe(0o600);
    }
    expect(
      Object.keys(
        JSON.parse(readFileSync(join(path, "owner.json"), "utf8"))
      ).sort()
    ).toEqual(["nonce", "pid"]);
    return Promise.resolve();
  });
});

test("thrown work releases the lock without hiding its error", async () => {
  const path = fixture();
  await expect(
    withCredentialLock(path, () => {
      throw new Error("work failed");
    })
  ).rejects.toThrow("work failed");
  expect(await withCredentialLock(path, async () => "reacquired")).toBe(
    "reacquired"
  );
});

test("recovers the lock only after its separate owner process has exited", async () => {
  const path = fixture();
  const crashed = child(path, "process.exit(19)");
  expect(await crashed.exited).toBe(19);
  expect(await withCredentialLock(path, async () => "recovered", 1000)).toBe(
    "recovered"
  );
});

test("a live owner is never displaced and a contender times out", async () => {
  const path = fixture();
  const owner = child(path, 'console.log("ready"); await Bun.sleep(400);');
  const reader = owner.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  const before = readFileSync(join(path, "owner.json"), "utf8");
  await expect(
    withCredentialLock(path, async () => "must not execute", 40)
  ).rejects.toThrow("Timed out");
  expect(readFileSync(join(path, "owner.json"), "utf8")).toBe(before);
  await successful(owner);
});

test("missing and malformed owners fail closed without age-based recovery", async () => {
  const path = fixture();
  mkdirSync(path, { mode: 0o700 });
  await expect(
    withCredentialLock(path, async () => "must not execute", 30)
  ).rejects.toThrow("Timed out");
  writeFileSync(
    join(path, "owner.json"),
    JSON.stringify({ pid: -1, nonce: "unknown" }),
    { mode: 0o600 }
  );
  await expect(
    withCredentialLock(path, async () => "must not execute", 30)
  ).rejects.toThrow("uncertain");
});

test("rejects symlink and public lock directories", async () => {
  const target = fixture();
  mkdirSync(target, { mode: 0o700 });
  const link = fixture();
  symlinkSync(target, link, "dir");
  await expect(
    withCredentialLock(link, async () => "must not execute", 30)
  ).rejects.toThrow("Unsafe");
  if (process.platform !== "win32") {
    const publicPath = fixture();
    mkdirSync(publicPath, { mode: 0o755 });
    await expect(
      withCredentialLock(publicPath, async () => "must not execute", 30)
    ).rejects.toThrow("Unsafe");
  }
});

test("release refuses to remove another owner's metadata", async () => {
  const path = fixture();
  await expect(
    withCredentialLock(path, () => {
      const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
      writeFileSync(
        join(path, "owner.json"),
        JSON.stringify({
          ...owner,
          nonce: "00000000-0000-0000-0000-000000000000",
        })
      );
      return Promise.resolve();
    })
  ).rejects.toThrow("uncertain");
  expect(JSON.parse(readFileSync(join(path, "owner.json"), "utf8")).nonce).toBe(
    "00000000-0000-0000-0000-000000000000"
  );
});

test("concurrent processes recover one dead owner without overlapping", async () => {
  const path = fixture();
  const crashed = child(path, "process.exit(19)");
  expect(await crashed.exited).toBe(19);
  const journal = join(base, "recovery-journal");
  const work = `appendFileSync(journal, "start\\n");
    await Bun.sleep(30); appendFileSync(journal, "end\\n");`;
  await Promise.all([
    successful(child(path, work, journal)),
    successful(child(path, work, journal)),
    successful(child(path, work, journal)),
  ]);
  expect(readFileSync(journal, "utf8")).toBe(
    "start\nend\nstart\nend\nstart\nend\n"
  );
});

test("a dead owner's uncertain reclamation marker is not stolen", async () => {
  const path = fixture();
  expect(await child(path, "process.exit(19)").exited).toBe(19);
  writeFileSync(join(path, "reclaim.json"), "uncertain", { mode: 0o600 });
  await expect(
    withCredentialLock(path, async () => "must not execute", 40)
  ).rejects.toThrow();
  expect(readFileSync(join(path, "reclaim.json"), "utf8")).toBe("uncertain");
});

test("rejects owner metadata symlinks", async () => {
  const path = fixture();
  mkdirSync(path, { mode: 0o700 });
  const target = join(base, "foreign-metadata");
  writeFileSync(target, "must not be read", { mode: 0o600 });
  symlinkSync(target, join(path, "owner.json"));
  await expect(
    withCredentialLock(path, async () => "must not execute", 30)
  ).rejects.toThrow("Unsafe");
  expect(readFileSync(target, "utf8")).toBe("must not be read");
});

test("waits through owner metadata publication without inferring death", async () => {
  const path = fixture();
  const publisher = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `
    import {mkdirSync,writeFileSync,unlinkSync,rmdirSync} from "node:fs";
    import {randomUUID} from "node:crypto";
    const path=process.argv[1];
    mkdirSync(path,{mode:0o700}); console.log("created");
    await Bun.sleep(60);
    writeFileSync(path+"/owner.json",JSON.stringify({pid:process.pid,nonce:randomUUID()}),{mode:0o600});
    await Bun.sleep(60);
    unlinkSync(path+"/owner.json"); rmdirSync(path);
  `,
      path,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const reader = publisher.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  expect(
    await withCredentialLock(path, async () => "after publication", 1000)
  ).toBe("after publication");
  await successful(publisher);
});

test("permission-denied PID probes preserve the owner and wait", async () => {
  const path = fixture();
  mkdirSync(path, { mode: 0o700 });
  const owner = JSON.stringify({
    pid: process.pid,
    nonce: "00000000-0000-0000-0000-000000000000",
  });
  writeFileSync(join(path, "owner.json"), owner, { mode: 0o600 });
  // Process liveness is an OS boundary. EPERM proves existence, not death.
  const probe = spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("permission denied"), { code: "EPERM" });
  });
  try {
    await expect(
      withCredentialLock(path, async () => "must not execute", 30)
    ).rejects.toThrow("Timed out");
    expect(readFileSync(join(path, "owner.json"), "utf8")).toBe(owner);
  } finally {
    probe.mockRestore();
  }
});

test("a stale dead-owner snapshot cannot insert metadata into a replacement lock", async () => {
  const path = fixture();
  expect(await child(path, "process.exit(19)").exited).toBe(19);
  const previous = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
  const replacement = JSON.stringify({
    pid: process.pid,
    nonce: crypto.randomUUID(),
  });
  const retired = fixture();
  const originalKill = process.kill.bind(process);
  let replaced = false;
  const probe = spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === previous.pid && !replaced) {
      replaced = true;
      fs.renameSync(path, retired);
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, "owner.json"), replacement, { mode: 0o600 });
      throw Object.assign(new Error("dead"), { code: "ESRCH" });
    }
    return originalKill(pid, signal);
  });
  try {
    await expect(
      withCredentialLock(path, async () => "must not execute", 50)
    ).rejects.toThrow("Timed out");
    expect(readFileSync(join(path, "owner.json"), "utf8")).toBe(replacement);
    expect(fs.readdirSync(path)).toEqual(["owner.json"]);
  } finally {
    probe.mockRestore();
  }
});

test("a stale contender cannot republish metadata between dead-owner removal and rmdir", async () => {
  const path = fixture();
  expect(await child(path, "process.exit(19)").exited).toBe(19);
  const previous = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
  const gate = fixture();
  const attempted = fixture();
  // Pause the contender after it has read the old owner, then let the winner
  // reach rmdir. Filesystem/process barriers force the formerly failing order.
  const contender = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `
    import * as fs from "node:fs";
    import {spyOn} from "bun:test";
    const [modulePath,path,pid,gate,attempted] = process.argv.slice(1);
    const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
    const originalKill = process.kill.bind(process);
    let first = true;
    process.kill = (value,signal) => {
      if (value === Number(pid) && first) {
        first = false; console.log("snapshot");
        while (!fs.existsSync(gate)) pause();
      }
      return originalKill(value,signal);
    };
    const originalWrite = fs.writeFileSync.bind(fs);
    spyOn(fs,"writeFileSync").mockImplementation((file,...args) => {
      if (String(file).includes("reclaim")) {
        try { return originalWrite(file,...args); }
        finally { originalWrite(attempted,"attempted"); }
      }
      return originalWrite(file,...args);
    });
    const {withCredentialLock} = await import(modulePath);
    await withCredentialLock(path, async () => {}, 2000);
  `,
      modulePath,
      path,
      String(previous.pid),
      gate,
      attempted,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const reader = contender.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(ready.value)).toContain("snapshot");
  const originalRemove = fs.rmdirSync;
  let interleaved = false;
  const remove = spyOn(fs, "rmdirSync").mockImplementation(
    (directory, options) => {
      if (String(directory) === path && !interleaved) {
        interleaved = true;
        writeFileSync(gate, "resume");
        const deadline = performance.now() + 1000;
        while (!fs.existsSync(attempted) && performance.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        expect(fs.existsSync(attempted)).toBe(true);
      }
      return originalRemove(directory, options);
    }
  );
  try {
    expect(await withCredentialLock(path, async () => "winner", 2000)).toBe(
      "winner"
    );
  } finally {
    remove.mockRestore();
    writeFileSync(gate, "resume");
  }
  await successful(contender);
  expect(interleaved).toBe(true);
});

test("claim cleanup refuses a replaced inode even when its owner metadata matches", async () => {
  const path = fixture();
  expect(await child(path, "process.exit(19)").exited).toBe(19);
  const previous = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
  const marker = `${path}.reclaim-${previous.nonce}`;
  const retired = fixture();
  const originalKill = process.kill.bind(process);
  let probes = 0;
  const probe = spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === previous.pid && ++probes === 2) {
      const metadata = readFileSync(marker, "utf8");
      fs.renameSync(marker, retired);
      writeFileSync(marker, metadata, { mode: 0o600 });
    }
    return originalKill(pid, signal);
  });
  try {
    await expect(
      withCredentialLock(path, async () => "must not execute", 1000)
    ).rejects.toThrow("uncertain");
    expect(readFileSync(marker, "utf8")).toBe(readFileSync(retired, "utf8"));
  } finally {
    probe.mockRestore();
  }
});
