import {
  assertUrlStructureSafe,
  detectIpVersion,
  isBlockedIp,
  type PinnedFetch,
  SsrfError,
} from "@teak/convex/linkMetadata/ssrf";
import {
  FILES_LINK_CHECK_MAX_REDIRECTS,
  FILES_LINK_CHECK_MAX_URL_LENGTH,
  FILES_LINK_CHECK_TIMEOUT_MS,
  type FilesLinkCheckParams,
  type FilesLinkCheckReason,
  type FilesLinkCheckResult,
} from "@teak/files-protocol";
import { createContainerPinnedFetch } from "./media/pinnedHop";
import type { RemoteAssetEnv } from "./media/remoteAsset";
import { RendererUnavailable } from "./media/rendererClient";

// The `check-link` op: is a saved link's page still there? It answers `dead`
// only for a 404 or 410 after redirects, or a domain that no longer exists.
// Anything it can't be sure of is `unsure`, so the original opens: a false
// "dead" would hide a live page behind an old copy. It never reads R2 and
// never uses Browser Rendering.

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_TYPES = { A: 1, AAAA: 28 } as const;
/** DoH `Status` for a name that does not exist. */
const NXDOMAIN = 3;
const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";
/** A GET only needs the headers; the hop reads at most one byte past this. */
const GET_MAX_BYTES = 1;

export const parseLinkCheckParams = (
  params: Record<string, unknown>
): FilesLinkCheckParams => {
  const { url } = params;
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > FILES_LINK_CHECK_MAX_URL_LENGTH ||
    !/^https?:\/\//iu.test(url)
  ) {
    throw new Error("invalid_link_check_params");
  }
  return { url };
};

export interface DnsAnswer {
  addresses: string[];
  /** The DoH response's `Status`: 0 is NOERROR, 3 is NXDOMAIN. */
  status: number;
}

export type DnsLookup = (
  hostname: string,
  type: keyof typeof DNS_TYPES,
  signal: AbortSignal
) => Promise<DnsAnswer>;

/**
 * Its own DoH lookup rather than `createDohResolver`, which answers an empty
 * list for NXDOMAIN and for a failed lookup alike. Here they differ: only
 * NXDOMAIN may make a link dead.
 */
export const createDohLookup =
  (fetcher: typeof fetch = fetch): DnsLookup =>
  async (hostname, type, signal) => {
    const url = new URL(DOH_ENDPOINT);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    const response = await fetcher(url.toString(), {
      headers: { accept: "application/dns-json" },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`doh_status_${response.status}`);
    }
    const body = (await response.json()) as {
      Answer?: Array<{ data?: unknown; type?: unknown }>;
      Status?: unknown;
    };
    if (typeof body.Status !== "number") {
      throw new Error("doh_bad_answer");
    }
    const addresses =
      body.Status === 0 && Array.isArray(body.Answer)
        ? body.Answer.filter(
            (answer) =>
              answer.type === DNS_TYPES[type] && typeof answer.data === "string"
          ).map((answer) => answer.data as string)
        : [];
    return { addresses, status: body.Status };
  };

type HostAnswer =
  | { addresses: string[]; kind: "addresses" }
  | { kind: "gone" }
  | { kind: "unsure"; reason: FilesLinkCheckReason };

const resolveHost = async (
  lookup: DnsLookup,
  hostname: string,
  signal: AbortSignal
): Promise<HostAnswer> => {
  if (detectIpVersion(hostname) !== 0) {
    return { addresses: [hostname], kind: "addresses" };
  }
  const answers = await Promise.allSettled([
    lookup(hostname, "A", signal),
    lookup(hostname, "AAAA", signal),
  ]);
  if (
    answers.every(
      (answer) =>
        answer.status === "fulfilled" && answer.value.status === NXDOMAIN
    )
  ) {
    return { kind: "gone" };
  }
  const addresses = answers.flatMap((answer) =>
    answer.status === "fulfilled" && answer.value.status === 0
      ? answer.value.addresses
      : []
  );
  if (addresses.length === 0) {
    return { kind: "unsure", reason: "dns_error" };
  }
  if (addresses.some(isBlockedIp)) {
    return { kind: "unsure", reason: "blocked" };
  }
  return { addresses, kind: "addresses" };
};

const unsure = (
  reason: FilesLinkCheckReason,
  httpStatus?: number
): FilesLinkCheckResult => ({
  outcome: "unsure",
  reason,
  ...(httpStatus === undefined ? {} : { httpStatus }),
});

export const classifyLinkStatus = (status: number): FilesLinkCheckResult => {
  if (status === 404 || status === 410) {
    return { httpStatus: status, outcome: "dead", reason: `http_${status}` };
  }
  if (status >= 200 && status < 300) {
    return { httpStatus: status, outcome: "alive", reason: "ok" };
  }
  return unsure("http_status", status);
};

const failureReason = (error: unknown): FilesLinkCheckReason => {
  if (error instanceof SsrfError) {
    return "blocked";
  }
  if (error instanceof RendererUnavailable) {
    return "fetcher_unavailable";
  }
  return "fetch_failed";
};

const isRedirect = (response: Response) =>
  response.status >= 300 &&
  response.status < 400 &&
  response.headers.has("location");

export interface LinkCheckDeps {
  hop: PinnedFetch;
  lookup: DnsLookup;
  timeoutMs?: number;
}

const followLink = async (
  url: string,
  { hop, lookup }: LinkCheckDeps,
  signal: AbortSignal
): Promise<FilesLinkCheckResult> => {
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    let parsed: URL;
    try {
      parsed = assertUrlStructureSafe(current);
    } catch {
      return unsure("blocked");
    }
    const host = await resolveHost(
      lookup,
      parsed.hostname.replace(/^\[|\]$/gu, ""),
      signal
    );
    if (host.kind === "gone") {
      return { outcome: "dead", reason: "dns" };
    }
    if (host.kind === "unsure") {
      return unsure(host.reason);
    }
    const send = (method: "GET" | "HEAD") =>
      hop(current, host.addresses, {
        headers: { accept: "*/*", "user-agent": USER_AGENT },
        method,
        redirect: "manual",
        signal,
      });
    let response: Response;
    try {
      response = await send("HEAD");
      if (response.status === 405 || response.status === 501) {
        await response.body?.cancel().catch(() => undefined);
        response = await send("GET");
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return unsure(failureReason(error));
    }
    await response.body?.cancel().catch(() => undefined);
    if (!isRedirect(response)) {
      return classifyLinkStatus(response.status);
    }
    if (redirects === FILES_LINK_CHECK_MAX_REDIRECTS) {
      return unsure("redirects", response.status);
    }
    try {
      current = new URL(
        response.headers.get("location") as string,
        current
      ).toString();
    } catch {
      return unsure("redirects", response.status);
    }
  }
};

/**
 * Checks one link within `timeoutMs` (3.5 s): its host, then a HEAD (or a
 * GET where HEAD isn't allowed) through the link fetcher, following up to
 * five redirects, each one checked again.
 */
export const checkLink = async (
  { url }: FilesLinkCheckParams,
  deps: LinkCheckDeps
): Promise<FilesLinkCheckResult> => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("link_check_timeout")),
    deps.timeoutMs ?? FILES_LINK_CHECK_TIMEOUT_MS
  );
  const timedOut = new Promise<FilesLinkCheckResult>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => resolve(unsure("timeout")),
      { once: true }
    );
  });
  try {
    return await Promise.race([
      followLink(url, deps, controller.signal).catch(() =>
        controller.signal.aborted ? unsure("timeout") : unsure("fetch_failed")
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("link_check_done"));
  }
};

export const checkLinkOp = (
  env: Pick<RemoteAssetEnv, "LINK_FETCHER" | "LINK_FETCHER_INSTANCES">,
  params: Record<string, unknown>
): Promise<FilesLinkCheckResult> =>
  checkLink(parseLinkCheckParams(params), {
    hop: createContainerPinnedFetch(env, {
      maxBytes: GET_MAX_BYTES,
      timeoutMs: FILES_LINK_CHECK_TIMEOUT_MS,
    }),
    lookup: createDohLookup(),
  });
