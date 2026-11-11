import { describe, expect, test } from "bun:test";
import { createDohResolver } from "./dns";
import { dohServer } from "./test/dohServer";

const PUBLIC = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

describe("DNS over HTTPS", () => {
  test("returns every A and AAAA address, without the CNAME chain", async () => {
    const { fetcher, queries } = dohServer({
      "www.example.com": {
        A: [PUBLIC],
        AAAA: [PUBLIC_V6],
        cname: "example.edgekey.net.",
      },
    });
    expect(await createDohResolver(fetcher)("www.example.com")).toEqual([
      PUBLIC,
      PUBLIC_V6,
    ]);
    expect(queries.sort()).toEqual([
      "www.example.com A",
      "www.example.com AAAA",
    ]);
  });

  test("a name that does not exist has no addresses", async () => {
    const { fetcher } = dohServer({});
    expect(await createDohResolver(fetcher)("nowhere.example")).toEqual([]);
  });

  test("fails when the resolver cannot be reached", async () => {
    const down = (() =>
      Promise.resolve(new Response("down", { status: 502 }))) as typeof fetch;
    await expect(createDohResolver(down)("example.com")).rejects.toThrow(
      "doh_unavailable"
    );
  });
});
