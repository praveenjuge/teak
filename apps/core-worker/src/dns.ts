import type { DnsResolver } from "@teak/files-protocol/ssrf";

// A Worker's own `fetch` cannot pin a connection to an address, so names are
// resolved over DNS-over-HTTPS and the link fetcher connects to the result.

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 5000;
const DNS_TYPES = { A: 1, AAAA: 28 } as const;
/** DoH `Status` values (DNS RCODEs). */
export const DNS_NOERROR = 0;
export const DNS_NXDOMAIN = 3;

export interface DnsAnswer {
  addresses: string[];
  /** The DoH response's `Status`. */
  status: number;
}

export type DnsLookup = (
  hostname: string,
  type: keyof typeof DNS_TYPES,
  signal: AbortSignal
) => Promise<DnsAnswer>;

/** One DoH query; keeps NXDOMAIN apart from a lookup that failed. */
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
    // The answer also lists the CNAME chain; only address records count.
    const addresses =
      body.Status === DNS_NOERROR && Array.isArray(body.Answer)
        ? body.Answer.filter(
            (answer) =>
              answer.type === DNS_TYPES[type] && typeof answer.data === "string"
          ).map((answer) => answer.data as string)
        : [];
    return { addresses, status: body.Status };
  };

/**
 * Every A and AAAA address of a name, for `safeFetch`. A name that doesn't
 * exist has none; it throws only when neither query could be answered.
 */
export const createDohResolver = (
  fetcher: typeof fetch = fetch
): DnsResolver => {
  const lookup = createDohLookup(fetcher);
  return async (hostname) => {
    const results = await Promise.allSettled(
      (["A", "AAAA"] as const).map((type) =>
        lookup(hostname, type, AbortSignal.timeout(DOH_TIMEOUT_MS))
      )
    );
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("doh_unavailable");
    }
    return results.flatMap((result) =>
      result.status === "fulfilled" ? result.value.addresses : []
    );
  };
};
