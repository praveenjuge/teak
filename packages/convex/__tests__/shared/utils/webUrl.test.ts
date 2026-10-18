import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchWebUrl, parseWebUrl } from "../../../shared/utils/webUrl";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseWebUrl", () => {
  test.each([
    "https://files.teakvault.com/a.png",
    "http://localhost:3000/a.png",
    "http://127.0.0.1/a.png",
    "http://[::1]:8787/a.png",
  ])("accepts %s", (value) => {
    expect(parseWebUrl(value)?.href).toBe(new URL(value).href);
  });

  test.each([
    "http://files.teakvault.com/a.png",
    "http://10.0.0.1/a.png",
    "file:///etc/hosts",
    "ftp://example.com/a.png",
    "not a url",
  ])("refuses %s", (value) => {
    expect(parseWebUrl(value)).toBeNull();
  });
});

describe("fetchWebUrl", () => {
  test("rejects a non-web link without sending a request", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response("x")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchWebUrl("file:///etc/hosts", undefined, () => new Error("not web"))
    ).rejects.toThrow("not web");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sends a web link with the given request", async () => {
    const requests: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method} ${String(input)}`);
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;
    const response = await fetchWebUrl(
      "https://files.teakvault.com/a.png",
      { method: "PUT" },
      () => new Error("not web")
    );
    expect(await response.text()).toBe("ok");
    expect(requests).toEqual(["PUT https://files.teakvault.com/a.png"]);
  });
});
