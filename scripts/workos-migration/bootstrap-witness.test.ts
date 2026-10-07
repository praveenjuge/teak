import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapWitness,
  parseWitnessArguments,
  type WitnessBoundary,
  type WitnessOptions,
} from "./bootstrap-witness";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function fixture(apply = true) {
  const directory = await mkdtemp(join(tmpdir(), "teak-witness-test-"));
  directories.push(directory);
  const options: WitnessOptions = {
    deployment: "isolated",
    environmentId: "environment_test",
    clientId: "client_test",
    apiKeyFingerprint: "a".repeat(64),
    teakUserId: "permanentOwner",
    expectedEmail: "controlled@example.com",
    journal: join(directory, "journal.jsonl"),
    apply,
    approvalReference: apply ? "separate-witness-approval" : undefined,
  };
  const owner = {
    teakUserId: options.teakUserId,
    email: options.expectedEmail,
    emailVerified: false,
    name: "Controlled",
    sourceVersion: "b".repeat(64),
    passwordHash: "PRIVATE_HASH_MUST_NOT_PERSIST",
    changedAt: 100,
    deletedAt: null,
    workosUserId: null,
  };
  const remote = {
    id: "user_test",
    externalId: owner.teakUserId,
    email: owner.email,
    emailVerified: owner.emailVerified,
  };
  const mutations: string[] = [];
  let holder = "";
  let creates = 0;
  let createInput: unknown;
  const boundary: WitnessBoundary = {
    witness: async () => null,
    listUsers: async () => ({ data: [], after: null }),
    createUser: (input) => {
      creates++;
      createInput = input;
      return Promise.resolve(remote);
    },
    getUser: async () => remote,
    run: async (name, input) => {
      const args = input as Record<string, unknown>;
      const operation = name.split(":")[1];
      if (
        [
          "acquire",
          "beginRemote",
          "acknowledgeRemote",
          "link",
          "release",
        ].includes(operation)
      ) {
        mutations.push(operation);
      }
      if (operation === "getAuthMode") {
        return {
          primary: "betterauth",
          signupsDisabled: true,
          authKitClientId: options.clientId,
        };
      }
      if (operation === "preflightPage") {
        return {
          owners: [{ ...owner, deleted: false, passwordFormat: "compatible" }],
          done: true,
          cursor: null,
        };
      }
      if (operation === "page") {
        return {
          owners: [owner],
          done: true,
          cursor: null,
          unresolvedQuarantine: false,
        };
      }
      if (operation === "version") {
        return owner.sourceVersion;
      }
      if (operation === "acquire") {
        const journal = await readFile(options.journal, "utf8");
        expect(journal).toContain('"stage":"acquiring"');
        holder = args.holder as string;
        return { holder, generation: 3 };
      }
      if (operation === "beginRemote") {
        expect(await readFile(options.journal, "utf8")).toContain(
          '"stage":"dispatch_prepared"'
        );
      }
      if (operation === "link") {
        return "linked";
      }
      if (operation === "quiescence") {
        return { ready: true, pendingRemote: false, holder, generation: 3 };
      }
      return null;
    },
  };
  return {
    options,
    boundary,
    owner,
    remote,
    mutations,
    creates: () => creates,
    input: () => createInput,
  };
}
test("read-only plan exports no credential material and never acquires authority", async () => {
  const f = await fixture(false);
  expect(await bootstrapWitness(f.options, f.boundary)).toEqual({
    status: "planned",
  });
  expect(f.mutations).toEqual([]);
  expect(f.creates()).toBe(0);
  expect(await readFile(f.options.journal, "utf8")).not.toContain(
    f.owner.passwordHash
  );
  expect((await stat(f.options.journal)).mode % 0o1000).toBe(0o600);
});
test("one create uses exact verification and owner without password and drains before returning", async () => {
  const f = await fixture();
  expect(await bootstrapWitness(f.options, f.boundary)).toEqual({
    status: "linked_pending_external_verification",
    workosUserId: "user_test",
  });
  expect(f.creates()).toBe(1);
  expect(f.input()).toEqual({
    email: f.owner.email,
    emailVerified: false,
    name: "Controlled",
    externalId: f.owner.teakUserId,
  });
  expect(f.mutations).toEqual([
    "acquire",
    "beginRemote",
    "acknowledgeRemote",
    "link",
    "release",
  ]);
  const journal = await readFile(f.options.journal, "utf8");
  expect(journal).not.toContain(f.owner.passwordHash);
  expect(journal).toContain('"generation":3');
  expect(journal).toContain('"stage":"provider_acknowledged"');
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow();
  expect(f.creates()).toBe(1);
});
test.each(["timeout", "server"])(
  "%s create failure keeps sticky intent and prevents second creation",
  async (kind) => {
    const f = await fixture();
    let attempts = 0;
    f.boundary.createUser = () => {
      attempts++;
      return Promise.reject(
        Object.assign(
          new Error("PRIVATE_TOKEN"),
          kind === "server" ? { status: 500 } : {}
        )
      );
    };
    await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
      "never retry automatically"
    );
    expect(f.mutations).toEqual(["acquire", "beginRemote"]);
    await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(await readFile(f.options.journal, "utf8")).not.toContain(
      "PRIVATE_TOKEN"
    );
  }
);
test("definite client rejection is acknowledged and released without linking", async () => {
  const f = await fixture();
  f.boundary.createUser = () =>
    Promise.reject(Object.assign(new Error("rejected"), { status: 422 }));
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow();
  expect(f.mutations).toEqual([
    "acquire",
    "beginRemote",
    "acknowledgeRemote",
    "release",
  ]);
});
test.each(["acquire", "beginRemote", "acknowledgeRemote", "link", "release"])(
  "lost %s acknowledgment never retries or releases automatically",
  async (target) => {
    const f = await fixture();
    const run = f.boundary.run;
    f.boundary.run = async (name, args) => {
      const result = await run(name, args);
      if (name.endsWith(`:${target}`)) {
        throw new Error("lost response");
      }
      return result;
    };
    await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow();
    expect(f.mutations.filter((name) => name === target)).toHaveLength(1);
    if (target !== "release") {
      expect(f.mutations).not.toContain("release");
    }
    expect(f.creates()).toBe(
      target === "acquire" || target === "beginRemote" ? 0 : 1
    );
  }
);
test.each([
  "deleted",
  "mapped",
  "email",
  "verification",
  "quarantine",
  "collision",
  "witness",
  "mode",
])("%s candidate blocks all authority", async (kind) => {
  const f = await fixture();
  const run = f.boundary.run;
  f.boundary.run = async (name, args) => {
    const result = (await run(name, args)) as Record<string, unknown>;
    if (kind === "mode" && name === "auth:getAuthMode") {
      return { ...result, signupsDisabled: false };
    }
    if (name.endsWith(":page")) {
      const owner = { ...f.owner };
      if (kind === "deleted") {
        owner.deletedAt = 1 as never;
      }
      if (kind === "mapped") {
        owner.workosUserId = "user_other" as never;
      }
      if (kind === "email") {
        owner.email = "changed@example.com";
      }
      if (kind === "verification") {
        owner.emailVerified = undefined as never;
      }
      return {
        ...result,
        owners: [owner],
        unresolvedQuarantine: kind === "quarantine",
      };
    }
    if (kind === "collision" && name.endsWith(":preflightPage")) {
      return { ...result, owners: [f.owner, f.owner] };
    }
    return result;
  };
  if (kind === "witness") {
    f.boundary.witness = async () => "user_existing";
  }
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow();
  expect(f.mutations).toEqual([]);
});
test("source CAS change after acquisition never dispatches a provider write", async () => {
  const f = await fixture();
  const run = f.boundary.run;
  f.boundary.run = async (name, args) =>
    name.endsWith(":version") ? "c".repeat(64) : run(name, args);
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
    "Source changed"
  );
  expect(f.creates()).toBe(0);
  expect(f.mutations).toEqual(["acquire"]);
});
test.each(["externalId", "emailVerified"])(
  "provider %s mismatch preserves intent before canonical link",
  async (field) => {
    const f = await fixture();
    f.boundary.createUser = async () => ({
      ...f.remote,
      [field]: field === "externalId" ? "wrongOwner" : true,
    });
    await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
      "mismatch"
    );
    expect(f.mutations).toEqual(["acquire", "beginRemote"]);
  }
);
test("canonical quarantined result cannot report success or release", async () => {
  const f = await fixture();
  const run = f.boundary.run;
  f.boundary.run = async (name, args) =>
    name.endsWith(":link") ? "quarantined" : run(name, args);
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
    "quarantined"
  );
  expect(f.mutations).not.toContain("release");
});
test("malformed pins or missing separate approval fail before journal IO", () => {
  expect(() => parseWitnessArguments(["--apply"])).toThrow();
  expect(() => parseWitnessArguments(["--deployment", "../prod"])).toThrow();
});

test.each(["provider", "source"])(
  "repeated %s cursor never admits a partial census",
  async (kind) => {
    const f = await fixture();
    if (kind === "provider") {
      f.boundary.listUsers = async () => ({ data: [], after: "repeat" });
    } else {
      const run = f.boundary.run;
      f.boundary.run = async (name, args) =>
        name.endsWith(":preflightPage")
          ? { owners: [], done: false, cursor: "repeat" }
          : run(name, args);
    }
    await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
      "cursor cycle"
    );
    expect(f.mutations).toEqual([]);
  }
);
test("create cannot dispatch until armed intent is durably recorded", async () => {
  const f = await fixture();
  const create = f.boundary.createUser;
  f.boundary.createUser = async (input) => {
    expect(await readFile(f.options.journal, "utf8")).toContain(
      '"stage":"armed"'
    );
    return create(input);
  };
  await bootstrapWitness(f.options, f.boundary);
});
test("failed drained proof cannot report a completed bootstrap", async () => {
  const f = await fixture();
  const run = f.boundary.run;
  f.boundary.run = async (name, args) =>
    name.endsWith(":quiescence")
      ? { ready: false, pendingRemote: true }
      : run(name, args);
  await expect(bootstrapWitness(f.options, f.boundary)).rejects.toThrow(
    "not verifiably drained"
  );
  expect(await readFile(f.options.journal, "utf8")).not.toContain(
    '"stage":"linked_pending_external_verification"'
  );
});
