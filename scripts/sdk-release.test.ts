import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, spawn } from "bun";
import {
  inspectPublished,
  provenanceReceipt,
  publicationInvocation,
  publicationMode,
  publisherEnvironment,
  readArtifact,
  validateRelease,
} from "./sdk-release.mjs";

// Release risks: wrong ref/commit/version, off-main tag, non-patch bump,
// corrupt local bytes, transport failure mistaken for absence, conflicting
// published metadata, untrusted tarball URL, or corrupt published bytes.
const bytes = Buffer.from("packed SDK artifact");
const artifact = {
  name: "teak-sdk",
  version: "1.0.1",
  filename: "teak-sdk-1.0.1.tgz",
  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
};
let status = 200;
let metadata: Record<string, unknown>;
let servedBytes = bytes;
const server = serve({
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname.endsWith(".tgz")) {
      return new Response(servedBytes);
    }
    return Response.json(metadata, { status });
  },
});
afterAll(() => server.stop(true));
const registry = server.url.origin;

test("OIDC publication requires an exact immutable version tag", () => {
  expect(publicationMode({ refType: "tag", refName: "v1.0.1" })).toBe("oidc");
  expect(() => publicationMode({ refType: "branch", refName: "main" })).toThrow(
    "immutable version tag"
  );
  expect(() =>
    publicationMode({ refType: "tag", refName: "v1.0.1-preview" })
  ).toThrow();
});

test("OIDC cannot inherit or fall back to any npm credential", () => {
  expect(publisherEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
  for (const name of ["BOOTSTRAP_AUTH_TOKEN", "NODE_AUTH_TOKEN", "NPM_TOKEN"]) {
    expect(() => publisherEnvironment({ [name]: "test-only" })).toThrow(
      "Inherited npm credentials"
    );
  }
});

test("publisher rejects alternate npm authentication and config selectors", () => {
  for (const name of [
    "npm_config__auth",
    "NPM_CONFIG__AUTH",
    "npm_config_userconfig",
    "NPM_CONFIG_GLOBALCONFIG",
    "npm_config_//registry.npmjs.org/:_authToken",
  ]) {
    expect(() => publisherEnvironment({ [name]: "test-only" })).toThrow(
      "Inherited npm configuration"
    );
  }
});

function resetRegistry() {
  status = 200;
  servedBytes = bytes;
  metadata = {
    name: artifact.name,
    version: artifact.version,
    dist: {
      integrity: artifact.integrity,
      tarball: `${registry}/teak-sdk/-/${artifact.filename}`,
    },
  };
}

test("registry absence is explicit, outages and invalid 404s fail closed", async () => {
  resetRegistry();
  status = 404;
  metadata = { error: "version not found" };
  expect(await inspectPublished(artifact, registry)).toBe(false);
  status = 503;
  await expect(inspectPublished(artifact, registry)).rejects.toThrow(
    "HTTP 503"
  );
  status = 404;
  metadata = {};
  await expect(inspectPublished(artifact, registry)).rejects.toThrow(
    "invalid missing-version"
  );
  await expect(
    inspectPublished(artifact, "http://127.0.0.1:1")
  ).rejects.toThrow();
});

test("repeat publication accepts only identical registry metadata and bytes", async () => {
  resetRegistry();
  expect(await inspectPublished(artifact, registry)).toBe(true);
  metadata.version = "1.0.2";
  await expect(inspectPublished(artifact, registry)).rejects.toThrow(
    "metadata differs"
  );
  resetRegistry();
  metadata.dist = {
    integrity: "sha512-other",
    tarball: `${registry}/teak-sdk/-/${artifact.filename}`,
  };
  await expect(inspectPublished(artifact, registry)).rejects.toThrow(
    "metadata differs"
  );
  resetRegistry();
  servedBytes = Buffer.from("tampered");
  await expect(inspectPublished(artifact, registry)).rejects.toThrow(
    "tarball bytes differ"
  );
});

test("published tarballs cannot redirect verification to another host or path", async () => {
  for (const tarball of [
    "http://127.0.0.1:1/private",
    `${registry}/other.tgz`,
    `${registry}/teak-sdk/-/${artifact.filename}?secret=1`,
  ]) {
    resetRegistry();
    metadata.dist = { integrity: artifact.integrity, tarball };
    await expect(inspectPublished(artifact, registry)).rejects.toThrow(
      "unexpected registry URL"
    );
  }
});

test("local packed metadata is bound to the exact tarball bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "teak-sdk-integrity-"));
  const metadataPath = join(directory, "pack.json");
  writeFileSync(metadataPath, JSON.stringify([artifact]));
  writeFileSync(join(directory, artifact.filename), bytes);
  expect(readArtifact(metadataPath)).toEqual(artifact);
  writeFileSync(join(directory, artifact.filename), "tampered");
  expect(() => readArtifact(metadataPath)).toThrow("recorded integrity");
  writeFileSync(
    metadataPath,
    JSON.stringify([{ ...artifact, filename: "../../outside" }])
  );
  expect(() => readArtifact(metadataPath)).toThrow(
    "Invalid packed SDK metadata"
  );
});

test("npm 12 pack metadata resolves the single SDK artifact and verifies its bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "teak-sdk-npm12-"));
  const metadataPath = join(directory, "pack.json");
  writeFileSync(metadataPath, JSON.stringify({ "teak-sdk": artifact }));
  writeFileSync(join(directory, artifact.filename), bytes);
  expect(readArtifact(metadataPath)).toEqual(artifact);
  writeFileSync(join(directory, artifact.filename), "tampered");
  expect(() => readArtifact(metadataPath)).toThrow("recorded integrity");
});

test.each(
  [
    {},
    [],
    [artifact, artifact],
    { "teak-sdk": artifact, other: artifact },
    { other: artifact },
    { "teak-sdk": null },
    { "teak-sdk": [artifact] },
    null,
  ].map((packed) => ({ packed }))
)(
  "pack metadata cannot select an ambiguous or malformed artifact (%j)",
  ({ packed }) => {
    const directory = mkdtempSync(join(tmpdir(), "teak-sdk-invalid-pack-"));
    const metadataPath = join(directory, "pack.json");
    writeFileSync(metadataPath, JSON.stringify(packed));
    expect(() => readArtifact(metadataPath)).toThrow();
  }
);

function releaseRepo(next = "1.0.1") {
  const directory = mkdtempSync(join(tmpdir(), "teak-sdk-tag-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  mkdirSync(join(directory, "packages/sdk"), { recursive: true });
  const writeVersion = (version: string) => {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
    writeFileSync(
      join(directory, "packages/sdk/package.json"),
      JSON.stringify({ name: "teak-sdk", version })
    );
    git("add", ".");
    git("commit", "--quiet", "-m", version);
  };
  writeVersion("1.0.0");
  const previous = git("rev-parse", "HEAD");
  writeVersion(next);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("tag", `v${next}`);
  return { directory, git, previous };
}

test("only the exact next-patch tag at its main commit can release", () => {
  const { directory, git, previous } = releaseRepo();
  expect(validateRelease(directory, "tag", "v1.0.1")).toBe("1.0.1");
  expect(() => validateRelease(directory, "branch", "main")).toThrow(
    "immutable version tag"
  );
  expect(() => validateRelease(directory, "tag", "v1.0.2")).toThrow();
  git("update-ref", "refs/tags/v1.0.1", previous);
  expect(() => validateRelease(directory, "tag", "v1.0.1")).toThrow(
    "checked-out commit"
  );
  git("update-ref", "refs/tags/v1.0.1", "HEAD");
  git("update-ref", "refs/remotes/origin/main", previous);
  expect(() => validateRelease(directory, "tag", "v1.0.1")).toThrow();
  const minor = releaseRepo("1.1.0");
  expect(() => validateRelease(minor.directory, "tag", "v1.1.0")).toThrow(
    "next patch"
  );
});

// npm verifies signatures cryptographically before this boundary checks release identity.
test("verified provenance must bind package bytes, repository, workflow, tag and commit", () => {
  const commit = "a".repeat(40);
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: "pkg:npm/teak-sdk@1.0.1",
        digest: { sha512: createHash("sha512").update(bytes).digest("hex") },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: "https://github.com/praveenjuge/teak",
            path: ".github/workflows/sdk-release.yml",
            ref: "refs/tags/v1.0.1",
          },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/praveenjuge/teak@refs/tags/v1.0.1",
            digest: { gitCommit: commit },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
      },
    },
  };
  const reportFor = (payload: unknown) => ({
    invalid: [],
    missing: [],
    verified: [
      {
        name: "teak-sdk",
        version: "1.0.1",
        registry: "https://registry.npmjs.org",
        attestationBundles: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify(payload)).toString(
                  "base64"
                ),
              },
            },
          },
        ],
      },
    ],
  });
  expect(
    provenanceReceipt(reportFor(statement), artifact, commit)
      .cryptographicallyVerified
  ).toBe(true);
  expect(() =>
    provenanceReceipt(
      { ...reportFor(statement), invalid: [{}] },
      artifact,
      commit
    )
  ).toThrow("signature verification");
  expect(() =>
    provenanceReceipt(
      { ...reportFor(statement), verified: [] },
      artifact,
      commit
    )
  ).toThrow("Missing verified");
  const mutations = [
    (value: typeof statement) => {
      value.subject[0].digest.sha512 = "wrong";
    },
    (value: typeof statement) => {
      value.subject[0].name = "pkg:npm/foreign@1.0.1";
    },
    (value: typeof statement) => {
      value.predicate.buildDefinition.externalParameters.workflow.repository =
        "https://github.com/foreign/repo";
    },
    (value: typeof statement) => {
      value.predicate.buildDefinition.externalParameters.workflow.path =
        ".github/workflows/other.yml";
    },
    (value: typeof statement) => {
      value.predicate.buildDefinition.externalParameters.workflow.ref =
        "refs/heads/main";
    },
    (value: typeof statement) => {
      value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
        "b".repeat(40);
    },
    (value: typeof statement) => {
      value.predicate.runDetails.builder.id = "self-hosted";
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(statement);
    mutate(value);
    expect(() => provenanceReceipt(reportFor(value), artifact, commit)).toThrow(
      "does not match"
    );
  }
});

test("publication does not transmit inherited credentials to a local registry", async () => {
  const poisoned = mkdtempSync(join(tmpdir(), "teak-sdk-poisoned-config-"));
  const authorization: (string | null)[] = [];
  const registryServer = serve({
    port: 0,
    fetch(request) {
      authorization.push(request.headers.get("authorization"));
      return Response.json({
        name: "test-only",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name: "test-only", version: "1.0.0" } },
      });
    },
  });
  try {
    const host = new URL(registryServer.url).host;
    writeFileSync(
      join(poisoned, ".npmrc"),
      `//${host}/:_authToken=test-only-never-transmit\n`
    );
    const environment = publisherEnvironment({
      PATH: process.env.PATH,
      HOME: poisoned,
    });
    const invoke = async (isolated: boolean) => {
      const invocation = publicationInvocation(environment);
      const flags = isolated
        ? invocation.flags.filter((flag) => !flag.startsWith("--registry="))
        : [];
      const child = spawn(
        [
          "npm",
          "view",
          "test-only",
          "version",
          `--registry=${registryServer.url.origin}`,
          ...flags,
        ],
        {
          cwd: isolated ? invocation.cwd : poisoned,
          env: invocation.env,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10_000,
        }
      );
      const [code, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, error: code ? error : "" }).toEqual({
        code: 0,
        error: "",
      });
      expect(output.trim()).toBe("1.0.0");
    };
    // Prove the poison is active without isolation, then exercise the publisher.
    await invoke(false);
    expect(authorization).toContain("Bearer test-only-never-transmit");
    authorization.length = 0;
    await invoke(true);
    expect(authorization.length).toBeGreaterThan(0);
    expect(authorization.every((value) => value === null)).toBe(true);
  } finally {
    registryServer.stop(true);
  }
});
