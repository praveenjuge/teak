import { expect } from "bun:test";

/** A DNS-over-HTTPS endpoint answering from `records`; other names are NXDOMAIN (3). */
export const dohServer = (
  records: Record<string, { A?: string[]; AAAA?: string[]; cname?: string }>
) => {
  const queries: string[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const name = url.searchParams.get("name") ?? "";
    const type = url.searchParams.get("type") as "A" | "AAAA";
    queries.push(`${name} ${type}`);
    expect(new Headers(init?.headers).get("accept")).toBe(
      "application/dns-json"
    );
    const record = records[name];
    if (!record) {
      return Promise.resolve(Response.json({ Status: 3 }));
    }
    return Promise.resolve(
      Response.json({
        Answer: [
          ...(record.cname ? [{ data: record.cname, name, type: 5 }] : []),
          ...(record[type] ?? []).map((data) => ({
            data,
            name,
            type: type === "A" ? 1 : 28,
          })),
        ],
        Status: 0,
      })
    );
  }) as typeof fetch;
  return { fetcher, queries };
};
