// Publishes one Teak Android release to Google Play: the signed bundle and its
// R8 mapping to the internal and production tracks, plus the store listing
// from apps/android/store/store.config.json. android-release.yml runs it.
//   node scripts/release/play-publish.ts publish --version <x.y.z> \
//     --bundle <aab> --mapping <mapping.txt> --dry-run <true|false> \
//     [--proof <out.json>] [--error-file <out.txt>]
// PLAY_SERVICE_ACCOUNT_JSON holds the service account key; RELEASE_NOTES
// overrides whatsNew for this run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sanitizeAscOutput } from "./apple-release-issue.ts";
import { errorMessage, parseArguments, required } from "./release-cli.ts";
import { parseVersion } from "./release-version.ts";

interface StoreListing {
  fullDescription: string;
  shortDescription: string;
  title: string;
}

/** apps/android/store/store.config.json */
interface StoreConfig {
  graphics?: { featureGraphic?: string; icon?: string };
  listing?: Partial<StoreListing>;
  locale: string;
  packageName: string;
  screenshots?: { phone?: string[] };
  whatsNew: string;
}

export interface ImageSet {
  files: string[];
  type: string;
}

export type PlayConfig = StoreConfig & {
  imageSets: ImageSet[];
  listing: StoreListing;
};

interface PlayRelease {
  name?: string;
  releaseNotes?: { language?: string; text?: string }[];
  status?: string;
  versionCodes?: (number | string)[];
}

/** The fields of Play Developer API replies this script reads. */
export interface PlayReply {
  bundles?: { sha256?: string; versionCode?: number | string }[];
  id?: string;
  images?: { sha256?: string }[];
  releases?: PlayRelease[];
  sha256?: string;
  versionCode?: number | string;
  [listingField: string]: unknown;
}

export interface PlayClient {
  call: (
    method: string,
    route: string,
    options?: { body?: unknown; query?: Record<string, string> }
  ) => Promise<PlayReply>;
  upload: (
    route: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
    options?: { resumable?: boolean }
  ) => Promise<PlayReply>;
}

interface ServiceAccount {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

type Log = (line: string) => void;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const configPath = "apps/android/store/store.config.json";
export const genericReleaseNotes =
  "Small fixes and polish to keep saving and organizing your ideas smooth and reliable.";
// Play Console's limits; the API doesn't publish them.
export const limits = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
  releaseNotes: 500,
};
export const releaseTracks = ["internal", "production"];
const apiRoot = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const uploadRoot =
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/androidpublisher";
// A rerun after a newer release must never move a track backwards.
const servingStatuses = new Set(["completed", "inProgress", "halted"]);

export function versionCodeFor(version: string) {
  const [major, minor, patch] = parseVersion(version);
  return major * 1_000_000 + minor * 1000 + patch;
}

export function loadConfig(repoRoot: string): PlayConfig {
  const config: StoreConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, configPath), "utf8")
  );
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(config.packageName)) {
    throw new Error(`${configPath}: invalid packageName.`);
  }
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(config.locale)) {
    throw new Error(`${configPath}: invalid locale.`);
  }
  if (typeof config.whatsNew !== "string") {
    throw new Error(`${configPath}: whatsNew must be a string.`);
  }
  for (const field of [
    "title",
    "shortDescription",
    "fullDescription",
  ] as const) {
    const value = config.listing?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${configPath}: listing.${field} is required.`);
    }
    if (value.length > limits[field]) {
      throw new Error(
        `${configPath}: listing.${field} is ${value.length} characters; Play allows ${limits[field]}.`
      );
    }
  }
  releaseNotesFor("", config);
  const graphics = path.join(
    repoRoot,
    "apps/android/store/listing",
    config.locale,
    "graphics"
  );
  const phone = config.screenshots?.phone ?? [];
  if (phone.length === 1 || phone.length > 8) {
    throw new Error(
      `${configPath}: Play takes 2 to 8 phone screenshots, not ${phone.length}.`
    );
  }
  const imageSets: ImageSet[] = [
    { type: "icon", files: [config.graphics?.icon] },
    { type: "featureGraphic", files: [config.graphics?.featureGraphic] },
    { type: "phoneScreenshots", files: phone },
  ]
    .map(({ type, files }) => ({
      type,
      files: files
        .filter((name): name is string => Boolean(name))
        .map((name) =>
          path.join(
            graphics,
            type === "phoneScreenshots" ? "phone-screenshots" : "",
            path.basename(name)
          )
        ),
    }))
    .filter(({ files }) => files.length > 0);
  for (const { files } of imageSets) {
    for (const file of files) {
      if (!fs.existsSync(file)) {
        throw new Error(`${configPath}: missing image ${file}.`);
      }
    }
  }
  return { ...config, imageSets, listing: config.listing as StoreListing };
}

export function releaseNotesFor(
  override: string | undefined,
  config: { whatsNew?: string }
) {
  const notes =
    String(override ?? "").trim() ||
    String(config.whatsNew ?? "").trim() ||
    genericReleaseNotes;
  if (notes.length > limits.releaseNotes) {
    throw new Error(
      `Release notes are ${notes.length} characters; Play allows ${limits.releaseNotes}.`
    );
  }
  return notes;
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export function signedAssertion(
  serviceAccount: ServiceAccount | undefined,
  nowSeconds: number
) {
  if (!(serviceAccount?.client_email && serviceAccount?.private_key)) {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON isn't a service account key.");
  }
  if ((serviceAccount.token_uri ?? tokenUrl) !== tokenUrl) {
    throw new Error(`The service account's token_uri must be ${tokenUrl}.`);
  }
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
      aud: tokenUrl,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), {
      key: serviceAccount.private_key,
    })
    .toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export async function accessToken(
  serviceAccount: ServiceAccount,
  {
    fetch = globalThis.fetch,
    now = Date.now,
  }: { fetch?: Fetch; now?: () => number } = {}
): Promise<string> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(serviceAccount, Math.floor(now() / 1000)),
    }),
  });
  const body: {
    access_token?: string;
    error?: string;
    error_description?: string;
  } = await response.json().catch(() => ({}));
  if (!(response.ok && body.access_token)) {
    throw new Error(
      `Google sign-in for the service account failed (${response.status}): ${body.error_description ?? body.error ?? "no detail"}`
    );
  }
  return body.access_token;
}

async function playError(response: Response, what: string) {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    detail = JSON.parse(text).error?.message ?? text;
  } catch {
    // Not JSON; keep the text.
  }
  return Object.assign(
    new Error(
      `Play API ${what} failed (${response.status}): ${detail || response.statusText}`
    ),
    { status: response.status }
  );
}

// The bearer token only ever goes to Google's own upload hosts.
export function uploadSession(location: string | null) {
  try {
    const url = new URL(String(location));
    const googleHost =
      url.hostname === "googleapis.com" ||
      url.hostname.endsWith(".googleapis.com");
    return url.protocol === "https:" && googleHost ? url : null;
  } catch {
    return null;
  }
}

export function playClient({
  token,
  packageName,
  fetch = globalThis.fetch,
}: {
  fetch?: Fetch;
  packageName: string;
  token: string;
}): PlayClient {
  const app = `applications/${encodeURIComponent(packageName)}`;
  const auth = { Authorization: `Bearer ${token}` };

  async function call(
    method: string,
    route: string,
    { body, query }: { body?: unknown; query?: Record<string, string> } = {}
  ): Promise<PlayReply> {
    const url = new URL(`${apiRoot}/${app}/${route}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method,
      headers: body ? { ...auth, "Content-Type": "application/json" } : auth,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw await playError(response, `${method} ${route}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async function upload(
    route: string,
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
    { resumable = false } = {}
  ): Promise<PlayReply> {
    const url = new URL(`${uploadRoot}/${app}/${route}`);
    if (!resumable) {
      url.searchParams.set("uploadType", "media");
      const response = await fetch(url, {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType },
        body: bytes,
      });
      if (!response.ok) {
        throw await playError(response, `upload ${route}`);
      }
      return response.json();
    }
    url.searchParams.set("uploadType", "resumable");
    for (let attempt = 1; ; attempt++) {
      const start = await fetch(url, {
        method: "POST",
        headers: {
          ...auth,
          "X-Upload-Content-Type": contentType,
          "X-Upload-Content-Length": String(bytes.length),
        },
      });
      if (!start.ok) {
        throw await playError(start, `start upload ${route}`);
      }
      const session = uploadSession(start.headers.get("location"));
      if (!session) {
        throw new Error(`Play didn't return an upload session for ${route}.`);
      }
      const response = await fetch(session, {
        method: "PUT",
        headers: { ...auth, "Content-Type": contentType },
        body: bytes,
      });
      if (response.ok) {
        return response.json();
      }
      // A server error or an expired session (404, 410) starts a new upload.
      const retryable =
        response.status >= 500 ||
        response.status === 404 ||
        response.status === 410;
      if (retryable && attempt < 3) {
        continue;
      }
      throw await playError(response, `upload ${route}`);
    }
  }

  return { call, upload };
}

export function sha256(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function highestServingCode(track: PlayReply) {
  let highest = 0;
  for (const release of track.releases ?? []) {
    if (!servingStatuses.has(release.status ?? "")) {
      continue;
    }
    for (const code of release.versionCodes ?? []) {
      highest = Math.max(highest, Number(code));
    }
  }
  return highest;
}

async function syncImages(
  client: PlayClient,
  edit: string | undefined,
  locale: string,
  imageSet: ImageSet,
  log: Log
) {
  const route = `edits/${edit}/listings/${locale}/${imageSet.type}`;
  const current = (await client.call("GET", route)).images ?? [];
  const files = imageSet.files.map((file) => fs.readFileSync(file));
  const wanted = files.map(sha256);
  if (
    current.length === wanted.length &&
    current.every((image, index) => image.sha256 === wanted[index])
  ) {
    log(`- ${imageSet.type}: unchanged (${wanted.length})`);
    return "unchanged";
  }
  await client.call("DELETE", route);
  for (const bytes of files) {
    await client.upload(route, bytes, "image/png");
  }
  log(`- ${imageSet.type}: replaced ${current.length} with ${wanted.length}`);
  return "replaced";
}

async function syncListing(
  client: PlayClient,
  edit: string | undefined,
  config: PlayConfig,
  log: Log
) {
  const route = `edits/${edit}/listings/${config.locale}`;
  let current: PlayReply = {};
  try {
    current = await client.call("GET", route);
  } catch (error) {
    if ((error as { status?: number }).status !== 404) {
      throw error;
    }
  }
  const listing: Record<string, string> = { ...config.listing };
  const changed = Object.keys(listing).filter(
    (field) => (current[field] ?? "") !== listing[field]
  );
  if (changed.length === 0) {
    log(`- Listing (${config.locale}): unchanged`);
    return [];
  }
  await client.call("PATCH", route, {
    body: { language: config.locale, ...config.listing },
  });
  for (const field of changed) {
    log(
      `- Listing ${field}: changed\n\n  Play now:\n\n${quote(current[field])}\n\n  From the repo:\n\n${quote(listing[field])}\n`
    );
  }
  return changed;
}

function quote(value: unknown) {
  return String(value ?? "(empty)")
    .split("\n")
    .map((line) => `    > ${line}`)
    .join("\n");
}

/**
 * One Play edit: guard against going backwards, upload the bundle (once per
 * version code) and mapping, sync the listing, point both tracks at this
 * version, validate, then commit or (dry run) throw the edit away. Committing
 * cancels any review in progress, so only the newest release is reviewed.
 */
export async function publish({
  client,
  config,
  version,
  bundle,
  mapping,
  releaseNotes,
  dryRun,
  log = console.log,
}: {
  bundle: Uint8Array<ArrayBuffer>;
  client: PlayClient;
  config: PlayConfig;
  dryRun: boolean;
  log?: Log;
  mapping: Uint8Array<ArrayBuffer>;
  releaseNotes: string;
  version: string;
}) {
  const versionCode = versionCodeFor(version);
  const edit = (await client.call("POST", "edits", { body: {} })).id;
  let committed = false;
  try {
    const production = await client.call(
      "GET",
      `edits/${edit}/tracks/production`
    );
    const highest = highestServingCode(production);
    if (highest >= versionCode && dryRun) {
      log(
        `- Production already serves version code ${highest}; a real run would skip ${version}. Checking the rest anyway.`
      );
    } else if (highest >= versionCode) {
      log(
        `Production already serves version code ${highest}, so ${version} (${versionCode}) isn't published.`
      );
      return {
        version,
        versionCode,
        skipped: true,
        committed: false,
        productionVersionCode: highest,
      };
    }

    const bundles =
      (await client.call("GET", `edits/${edit}/bundles`)).bundles ?? [];
    const existing = bundles.find(
      (item) => Number(item.versionCode) === versionCode
    );
    if (existing) {
      // The mapping only fits the exact bundle it came from.
      if (existing.sha256 !== sha256(bundle)) {
        throw new Error(
          `Play already has a different bundle with version code ${versionCode}; its mapping wouldn't match. Ship the next patch version instead.`
        );
      }
      log(`- Bundle ${versionCode}: already uploaded, reused`);
    } else {
      const uploaded = await client.upload(
        `edits/${edit}/bundles`,
        bundle,
        "application/octet-stream",
        { resumable: true }
      );
      if (Number(uploaded.versionCode) !== versionCode) {
        throw new Error(
          `The bundle has version code ${uploaded.versionCode}, not ${versionCode}.`
        );
      }
      log(`- Bundle ${versionCode}: uploaded (sha256 ${uploaded.sha256})`);
    }
    await client.upload(
      `edits/${edit}/apks/${versionCode}/deobfuscationFiles/proguard`,
      mapping,
      "application/octet-stream",
      { resumable: true }
    );
    log("- R8 mapping: uploaded");

    const listingChanges = await syncListing(client, edit, config, log);
    const images: Record<string, string> = {};
    for (const imageSet of config.imageSets) {
      images[imageSet.type] = await syncImages(
        client,
        edit,
        config.locale,
        imageSet,
        log
      );
    }

    for (const track of releaseTracks) {
      await client.call("PUT", `edits/${edit}/tracks/${track}`, {
        body: {
          track,
          releases: [
            {
              name: version,
              versionCodes: [String(versionCode)],
              status: "completed",
              releaseNotes: [{ language: config.locale, text: releaseNotes }],
            },
          ],
        },
      });
    }
    log(
      `- Tracks: ${releaseTracks.join(" and ")} set to ${versionCode}, full rollout`
    );
    log(`- Release notes:\n\n${quote(releaseNotes)}\n`);

    await client.call("POST", `edits/${edit}:validate`);
    log("- Edit validated by Play");
    if (dryRun) {
      return {
        version,
        versionCode,
        dryRun: true,
        committed: false,
        listingChanges,
        images,
        releaseNotes,
      };
    }
    await client.call("POST", `edits/${edit}:commit`, {
      query: { changesInReviewBehavior: "CANCEL_IN_REVIEW_AND_SUBMIT" },
    });
    committed = true;
    log("- Committed and sent for review");
    return {
      version,
      versionCode,
      committed: true,
      listingChanges,
      images,
      releaseNotes,
    };
  } finally {
    if (!committed) {
      await client.call("DELETE", `edits/${edit}`).catch(() => undefined);
    }
  }
}

/** Reads both tracks back in a throwaway edit and checks they serve this version. */
export async function readProof({
  client,
  version,
  releaseNotes,
  now = () => new Date(),
}: {
  client: PlayClient;
  now?: () => Date;
  releaseNotes: string;
  version: string;
}) {
  const versionCode = String(versionCodeFor(version));
  const edit = (await client.call("POST", "edits", { body: {} })).id;
  try {
    const tracks: Record<
      string,
      Pick<PlayRelease, "status" | "versionCodes">
    > = {};
    for (const track of releaseTracks) {
      const result = await client.call("GET", `edits/${edit}/tracks/${track}`);
      const release = (result.releases ?? []).find((item) =>
        (item.versionCodes ?? []).map(String).includes(versionCode)
      );
      if (release?.status !== "completed") {
        throw new Error(
          `The ${track} track doesn't serve ${versionCode} as a completed release.`
        );
      }
      if (release.releaseNotes?.[0]?.text !== releaseNotes) {
        throw new Error(`The ${track} track's release notes don't match.`);
      }
      tracks[track] = {
        status: release.status,
        versionCodes: release.versionCodes,
      };
    }
    return {
      version,
      versionCode: Number(versionCode),
      tracks,
      releaseNotes,
      checkedAt: now().toISOString(),
    };
  } finally {
    await client.call("DELETE", `edits/${edit}`).catch(() => undefined);
  }
}

// Play has the release by now, so a failed read-back is a warning, not a
// failed release: the run stays green and no proof is attached.
async function writeProof({
  client,
  version,
  releaseNotes,
  path: proofPath,
  log,
}: {
  client: PlayClient;
  log: Log;
  path: string;
  releaseNotes: string;
  version: string;
}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const proof = await readProof({ client, version, releaseNotes });
      fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
      log(`- Proof: internal and production serve ${proof.versionCode}`);
      return;
    } catch (error) {
      if (attempt === 3) {
        log(
          `- Proof: not attached, the read-back failed: ${sanitizeAscOutput(errorMessage(error))}`
        );
        console.log(
          `::warning::Play has ${version}, but reading the tracks back failed. Rerun to attach the proof.`
        );
      }
    }
  }
}

function parseServiceAccount(keyJson: string): ServiceAccount {
  try {
    return JSON.parse(keyJson);
  } catch {
    throw new Error("PLAY_SERVICE_ACCOUNT_JSON isn't valid JSON.");
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "publish") {
    throw new Error("Expected the publish command.");
  }
  const values = parseArguments(args);
  try {
    if (!["true", "false"].includes(values["dry-run"] ?? "")) {
      throw new Error("--dry-run must be true or false.");
    }
    const dryRun = values["dry-run"] === "true";
    const config = loadConfig(process.cwd());
    const releaseNotes = releaseNotesFor(process.env.RELEASE_NOTES, config);
    const keyJson = process.env.PLAY_SERVICE_ACCOUNT_JSON;
    if (!keyJson) {
      throw new Error(
        'PLAY_SERVICE_ACCOUNT_JSON is missing. See "One-time setup" in apps/android/release.md.'
      );
    }
    const serviceAccount = parseServiceAccount(keyJson);
    const token = await accessToken(serviceAccount);
    const client = playClient({ token, packageName: config.packageName });
    const summary = values.summary ?? process.env.GITHUB_STEP_SUMMARY;
    const log = (line: string) => {
      console.log(line);
      if (summary) {
        fs.appendFileSync(summary, `${line}\n`);
      }
    };
    const version = required(values.version, "--version");
    log(`### Google Play ${version}${dryRun ? " (dry run)" : ""}\n`);
    const result = await publish({
      client,
      config,
      version,
      bundle: fs.readFileSync(required(values.bundle, "--bundle")),
      mapping: fs.readFileSync(required(values.mapping, "--mapping")),
      releaseNotes,
      dryRun,
      log,
    });
    // A rerun of the version production already serves retries the proof.
    const submitted =
      result.committed || result.productionVersionCode === result.versionCode;
    if (!dryRun && submitted && values.proof) {
      await writeProof({
        client,
        version,
        releaseNotes,
        path: values.proof,
        log,
      });
    }
  } catch (error) {
    if (values["error-file"]) {
      fs.writeFileSync(
        values["error-file"],
        sanitizeAscOutput(errorMessage(error))
      );
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
