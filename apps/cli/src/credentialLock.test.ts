import { afterAll, expect, spyOn, test } from "bun:test";
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
function child(path: string, body: string) {
  return Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `
    import {withCredentialLock} from ${JSON.stringify(modulePath)};
    import {appendFileSync} from "node:fs";
    await withCredentialLock(${JSON.stringify(path)}, async () => { ${body} });
  `,
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
  const work = `appendFileSync(${JSON.stringify(journal)}, "start\\n");
    await Bun.sleep(80); appendFileSync(${JSON.stringify(journal)}, "end\\n");`;
  await Promise.all([
    successful(child(path, work)),
    successful(child(path, work)),
    successful(child(path, work)),
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
  const work = `appendFileSync(${JSON.stringify(journal)}, "start\\n");
    await Bun.sleep(30); appendFileSync(${JSON.stringify(journal)}, "end\\n");`;
  await Promise.all([
    successful(child(path, work)),
    successful(child(path, work)),
    successful(child(path, work)),
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
    const path=${JSON.stringify(path)};
    mkdirSync(path,{mode:0o700}); console.log("created");
    await Bun.sleep(60);
    writeFileSync(path+"/owner.json",JSON.stringify({pid:process.pid,nonce:randomUUID()}),{mode:0o600});
    await Bun.sleep(60);
    unlinkSync(path+"/owner.json"); rmdirSync(path);
  `,
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
