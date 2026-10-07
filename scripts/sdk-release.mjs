import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatchBump, parseVersion } from "./release-version.mjs";

const registry = "https://registry.npmjs.org";
const maxTarballBytes = 10 * 1024 * 1024;
export function publicationMode({ refType, refName }) {
  if (refType !== "tag" || !refName?.startsWith("v")) {
    throw new Error("SDK publication requires an immutable version tag.");
  }
  parseVersion(refName.slice(1));
  return "oidc";
}

export function publisherEnvironment(source) {
  for (const [name, value] of Object.entries(source)) {
    if (/^npm_config_/i.test(name) && value) {
      throw new Error(
        "Inherited npm configuration is forbidden for SDK publication."
      );
    }
    if (
      ["BOOTSTRAP_AUTH_TOKEN", "NODE_AUTH_TOKEN", "NPM_TOKEN"].includes(name) &&
      value
    ) {
      throw new Error(
        "Inherited npm credentials are forbidden for SDK publication."
      );
    }
  }
  return { ...source };
}

export function publicationInvocation(environment) {
  const directory = mkdtempSync(
    join(environment.RUNNER_TEMP ?? tmpdir(), "sdk-publisher-config-")
  );
  const userConfig = join(directory, "npmrc");
  const globalConfig = join(directory, "global.npmrc");
  writeFileSync(userConfig, "", { mode: 0o600 });
  writeFileSync(globalConfig, "", { mode: 0o600 });
  return {
    cwd: directory,
    env: environment,
    flags: [
      `--registry=${registry}`,
      `--userconfig=${userConfig}`,
      `--globalconfig=${globalConfig}`,
    ],
  };
}

export function validateRelease(repoRoot, refType, refName) {
  if (refType !== "tag" || !refName?.startsWith("v")) {
    throw new Error("SDK publication requires an immutable version tag.");
  }
  const version = refName.slice(1);
  parseVersion(version);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const head = git("rev-parse", "HEAD");
  if (git("rev-parse", `refs/tags/${refName}^{commit}`) !== head) {
    throw new Error("Release tag does not point to the checked-out commit.");
  }
  git("merge-base", "--is-ancestor", head, "origin/main");
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json")));
  const sdk = JSON.parse(
    readFileSync(resolve(repoRoot, "packages/sdk/package.json"))
  );
  if (
    manifest.version !== version ||
    sdk.version !== version ||
    sdk.name !== "teak-sdk"
  ) {
    throw new Error(
      "Release tag, root version, and teak-sdk version must match."
    );
  }
  const previous = JSON.parse(git("show", "HEAD^:package.json")).version;
  assertPatchBump(previous, version);
  return version;
}

export function readArtifact(metadataPath) {
  const packed = JSON.parse(readFileSync(metadataPath, "utf8"));
  // npm 12 keys pack output by package name; npm 11 returns an array.
  let entries = [];
  if (Array.isArray(packed)) {
    entries = packed;
  } else if (
    packed &&
    typeof packed === "object" &&
    Object.keys(packed).length === 1 &&
    Object.hasOwn(packed, "teak-sdk")
  ) {
    entries = [packed["teak-sdk"]];
  }
  if (entries.length !== 1) {
    throw new Error("Expected exactly one packed SDK artifact.");
  }
  const artifact = entries[0];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Invalid packed SDK metadata.");
  }
  parseVersion(artifact.version);
  if (
    artifact.name !== "teak-sdk" ||
    artifact.filename !== `teak-sdk-${artifact.version}.tgz` ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)
  ) {
    throw new Error("Invalid packed SDK metadata.");
  }
  const bytes = readFileSync(resolve(metadataPath, "..", artifact.filename));
  if (
    bytes.length > maxTarballBytes ||
    integrity(bytes) !== artifact.integrity
  ) {
    throw new Error("Packed SDK bytes do not match their recorded integrity.");
  }
  return artifact;
}

function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function request(url, signal) {
  return await fetch(url, {
    redirect: "error",
    signal,
  });
}

class PendingRegistryTarball extends Error {}

export async function inspectPublished(
  artifact,
  registryUrl = registry,
  timeoutMs = 30_000
) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await request(
    `${registryUrl}/teak-sdk/${artifact.version}`,
    signal
  );
  if (response.status === 404) {
    const missing = await response.json();
    if (
      missing !== `version not found: ${artifact.version}` &&
      !(
        missing !== null &&
        typeof missing === "object" &&
        !Array.isArray(missing) &&
        typeof missing.error === "string"
      )
    ) {
      throw new Error("Registry returned an invalid missing-version response.");
    }
    return false;
  }
  if (!response.ok) {
    throw new Error(`Registry version lookup failed: HTTP ${response.status}.`);
  }
  const published = await response.json();
  if (
    published.name !== artifact.name ||
    published.version !== artifact.version ||
    published.dist?.integrity !== artifact.integrity
  ) {
    throw new Error(
      "Published SDK metadata differs from the release artifact."
    );
  }
  const url = new URL(published.dist.tarball);
  if (
    url.origin !== new URL(registryUrl).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/teak-sdk/-/${artifact.filename}`
  ) {
    throw new Error("Published SDK tarball has an unexpected registry URL.");
  }
  const tarball = await request(url, signal);
  if (tarball.status === 404) {
    // Matching metadata exists, so this is never permission to publish again.
    // Only post-publication visibility polling may wait for its bytes.
    throw new PendingRegistryTarball(
      "Registry tarball download failed: HTTP 404."
    );
  }
  if (!(tarball.ok && tarball.body)) {
    throw new Error(
      `Registry tarball download failed: HTTP ${tarball.status}.`
    );
  }
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of tarball.body) {
    size += chunk.length;
    if (size > maxTarballBytes) {
      throw new Error("Published SDK tarball exceeds the size limit.");
    }
    hash.update(chunk);
  }
  if (`sha512-${hash.digest("base64")}` !== artifact.integrity) {
    throw new Error(
      "Published SDK tarball bytes differ from the release artifact."
    );
  }
  return true;
}

export function provenanceReceipt(report, artifact, commit) {
  if (
    !Array.isArray(report.invalid) ||
    report.invalid.length ||
    !Array.isArray(report.missing) ||
    report.missing.length ||
    !Array.isArray(report.verified)
  ) {
    throw new Error("npm signature verification failed.");
  }
  const entries = report.verified.filter(
    (entry) =>
      entry.name === artifact.name &&
      entry.version === artifact.version &&
      (entry.registry === registry || entry.registry === `${registry}/`)
  );
  if (entries.length !== 1) {
    throw new Error("Missing verified SDK attestation.");
  }
  const bundles = entries[0].attestationBundles?.filter(
    (entry) => entry.predicateType === "https://slsa.dev/provenance/v1"
  );
  if (bundles?.length !== 1) {
    throw new Error("Missing unique verified SDK provenance.");
  }
  const statement = JSON.parse(
    Buffer.from(bundles[0].bundle.dsseEnvelope.payload, "base64").toString(
      "utf8"
    )
  );
  const definition = statement.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  const ref = `refs/tags/v${artifact.version}`;
  const repository = "https://github.com/praveenjuge/teak";
  const expectedDigest = Buffer.from(
    artifact.integrity.slice("sha512-".length),
    "base64"
  ).toString("hex");
  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== "https://slsa.dev/provenance/v1" ||
    statement.subject?.length !== 1 ||
    statement.subject[0].name !==
      `pkg:npm/${artifact.name}@${artifact.version}` ||
    statement.subject[0].digest?.sha512 !== expectedDigest ||
    definition?.buildType !==
      "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1" ||
    workflow?.repository !== repository ||
    workflow?.path !== ".github/workflows/sdk-release.yml" ||
    workflow?.ref !== ref ||
    !definition.resolvedDependencies?.some(
      (dependency) =>
        dependency.uri === `git+${repository}@${ref}` &&
        dependency.digest?.gitCommit === commit
    ) ||
    statement.predicate?.runDetails?.builder?.id !==
      "https://github.com/actions/runner/github-hosted"
  ) {
    throw new Error("Verified SDK provenance does not match this release.");
  }
  return {
    name: artifact.name,
    version: artifact.version,
    integrity: artifact.integrity,
    commit,
    repository,
    workflow: workflow.path,
    ref,
    cryptographicallyVerified: true,
  };
}

export function verifyProvenance(artifact, metadataPath) {
  const directory = mkdtempSync(
    join(process.env.RUNNER_TEMP ?? tmpdir(), "sdk-provenance-")
  );
  const userConfig = join(directory, "user.npmrc");
  const globalConfig = join(directory, "global.npmrc");
  writeFileSync(userConfig, "", { mode: 0o600 });
  writeFileSync(globalConfig, "", { mode: 0o600 });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "teak-sdk-release-verifier",
      version: "1.0.0",
      private: true,
    })
  );
  const { BOOTSTRAP_AUTH_TOKEN, NODE_AUTH_TOKEN, NPM_TOKEN, ...source } =
    process.env;
  const environment = publisherEnvironment(source);
  const flags = [
    `--userconfig=${userConfig}`,
    `--globalconfig=${globalConfig}`,
    `--registry=${registry}`,
  ];
  execFileSync(
    "npm",
    [
      "install",
      `${artifact.name}@${artifact.version}`,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...flags,
    ],
    {
      cwd: directory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }
  );
  const report = JSON.parse(
    execFileSync(
      "npm",
      ["audit", "signatures", "--json", "--include-attestations", ...flags],
      {
        cwd: directory,
        env: environment,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      }
    )
  );
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const receipt = provenanceReceipt(report, artifact, commit);
  writeFileSync(
    resolve(metadataPath, "..", "provenance-receipt.json"),
    JSON.stringify({ receipt, report }, null, 2)
  );
  return receipt;
}

async function main() {
  const [command, metadataPath] = process.argv.slice(2);
  publicationMode({
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
  });
  if (command === "validate") {
    const version = validateRelease(
      process.cwd(),
      process.env.GITHUB_REF_TYPE,
      process.env.GITHUB_REF_NAME
    );
    console.log(`Validated immutable SDK release v${version}.`);
    return;
  }
  if (!(metadataPath && ["check", "verify", "publish"].includes(command))) {
    throw new Error(
      "Usage: node scripts/sdk-release.mjs validate | check <pack.json> | publish <pack.json> | verify <pack.json>"
    );
  }
  const artifact = readArtifact(metadataPath);
  if (artifact.version !== process.env.GITHUB_REF_NAME.slice(1)) {
    throw new Error("Packed artifact version does not match the release tag.");
  }
  if (command === "check") {
    const published = await inspectPublished(artifact);
    if (published) {
      verifyProvenance(artifact, metadataPath);
    }
    if (!process.env.GITHUB_OUTPUT) {
      throw new Error(
        "GITHUB_OUTPUT is required for the publication decision."
      );
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `should_publish=${!published}\n`);
    console.log(
      published
        ? "Existing SDK version verified byte for byte."
        : "SDK version is absent from npm."
    );
    return;
  }
  if (command === "publish") {
    validateRelease(
      process.cwd(),
      process.env.GITHUB_REF_TYPE,
      process.env.GITHUB_REF_NAME
    );
    const environment = publisherEnvironment(process.env);
    if (await inspectPublished(artifact)) {
      verifyProvenance(artifact, metadataPath);
      console.log(
        "Existing SDK artifact and provenance verified; publication is unnecessary."
      );
      return;
    }
    const invocation = publicationInvocation(environment);
    execFileSync(
      "npm",
      [
        "publish",
        resolve(metadataPath, "..", artifact.filename),
        "--provenance",
        "--access",
        "public",
        ...invocation.flags,
      ],
      { cwd: invocation.cwd, env: invocation.env, stdio: "inherit" }
    );
    return;
  }
  if (await waitForPublished(artifact)) {
    verifyProvenance(artifact, metadataPath);
    console.log(
      "Published SDK metadata, tarball integrity and provenance verified."
    );
    return;
  }
  throw new Error(
    "Published SDK version did not become visible within the npm processing window."
  );
}

export async function waitForPublished(
  artifact,
  {
    registryUrl = registry,
    attempts = 60,
    intervalMs = 5000,
    timeoutMs = 300_000,
    now = Date.now,
    wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {}
) {
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 60 ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > 5000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000
  ) {
    throw new Error("Invalid SDK registry visibility window.");
  }
  const deadline = now() + timeoutMs;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      return false;
    }
    try {
      if (
        await inspectPublished(
          artifact,
          registryUrl,
          Math.min(30_000, remaining)
        )
      ) {
        return true;
      }
    } catch (error) {
      if (!(error instanceof PendingRegistryTarball)) {
        throw error;
      }
    }
    if (attempt + 1 < attempts) {
      await wait(Math.max(0, Math.min(intervalMs, deadline - now())));
    }
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
