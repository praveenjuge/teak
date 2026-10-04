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
// biome-ignore lint/suspicious/noTemplateCurlyInString: npm interpolates the environment placeholder; never persist the credential.
const bootstrapNpmrc = "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n";

export function publicationMode({ bootstrap, event, refType, refName }) {
  if (!["true", "false"].includes(bootstrap)) {
    throw new Error("SDK_BOOTSTRAP must explicitly be true or false.");
  }
  if (refType !== "tag" || !refName?.startsWith("v")) {
    throw new Error("SDK publication requires an immutable version tag.");
  }
  parseVersion(refName.slice(1));
  if (bootstrap === "true" && event !== "workflow_dispatch") {
    throw new Error("Bootstrap requires an explicit manual tag dispatch.");
  }
  return bootstrap === "true" ? "bootstrap" : "oidc";
}

export function publisherEnvironment(mode, source) {
  const {
    BOOTSTRAP_AUTH_TOKEN: token,
    NODE_AUTH_TOKEN,
    NPM_TOKEN,
    ...environment
  } = source;
  for (const [name, value] of Object.entries(environment)) {
    if (/^npm_config_/i.test(name) && value) {
      throw new Error(
        "Inherited npm configuration is forbidden for SDK publication."
      );
    }
  }
  if (NODE_AUTH_TOKEN || NPM_TOKEN) {
    throw new Error(
      "Inherited npm credentials are forbidden for SDK publication."
    );
  }
  if (mode === "bootstrap") {
    if (!token?.trim()) {
      throw new Error("Approved bootstrap credential is missing.");
    }
    return { ...environment, NODE_AUTH_TOKEN: token };
  }
  if (mode !== "oidc" || token) {
    throw new Error("Temporary credentials are forbidden outside bootstrap.");
  }
  return environment;
}

export function publicationInvocation(mode, environment) {
  const directory = mkdtempSync(
    join(environment.RUNNER_TEMP ?? tmpdir(), "sdk-publisher-config-")
  );
  const userConfig = join(directory, "npmrc");
  const globalConfig = join(directory, "global.npmrc");
  writeFileSync(userConfig, mode === "bootstrap" ? bootstrapNpmrc : "", {
    mode: 0o600,
  });
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

export async function assertInitialPackage(registryUrl = registry) {
  const response = await request(`${registryUrl}/teak-sdk`);
  if (response.status !== 404) {
    throw new Error(
      `Bootstrap requires an unpublished package; registry returned HTTP ${response.status}.`
    );
  }
  const missing = await response.json();
  if (typeof missing.error !== "string") {
    throw new Error("Registry returned an invalid missing-package response.");
  }
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
  const entries = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error("Expected exactly one packed SDK artifact.");
  }
  const artifact = entries[0];
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

async function request(url) {
  return await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}

export async function inspectPublished(artifact, registryUrl = registry) {
  const response = await request(`${registryUrl}/teak-sdk/${artifact.version}`);
  if (response.status === 404) {
    const missing = await response.json();
    if (typeof missing.error !== "string") {
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
  const tarball = await request(url);
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
      entry.registry === registry
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
  const environment = publisherEnvironment("oidc", source);
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
  const mode = publicationMode({
    bootstrap: process.env.SDK_BOOTSTRAP,
    event: process.env.GITHUB_EVENT_NAME,
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
    } else if (mode === "bootstrap") {
      await assertInitialPackage();
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
    const environment = publisherEnvironment(mode, process.env);
    if (await inspectPublished(artifact)) {
      verifyProvenance(artifact, metadataPath);
      console.log(
        "Existing SDK artifact and provenance verified; publication is unnecessary."
      );
      return;
    }
    if (mode === "bootstrap") {
      await assertInitialPackage();
    }
    const invocation = publicationInvocation(mode, environment);
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
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await inspectPublished(artifact)) {
      verifyProvenance(artifact, metadataPath);
      console.log(
        "Published SDK metadata, tarball integrity and provenance verified."
      );
      return;
    }
    await new Promise((done) => setTimeout(done, 5000));
  }
  throw new Error("Published SDK version did not become visible in npm.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
