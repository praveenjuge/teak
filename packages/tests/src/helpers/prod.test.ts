import { describe, expect, mock, test } from "bun:test";
import type { Page } from "@playwright/test";
import { createProdE2EFetch, gotoApp, retryClickUntil } from "./prod";

describe("production E2E API retries", () => {
  test("retries transient card-create failures with one idempotency key", async () => {
    const keys: string[] = [];
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Request(input, init).headers.get("Idempotency-Key") ?? "");
      signals.push(init?.signal);
      return Promise.resolve(
        new Response(null, { status: keys.length === 1 ? 500 : 200 })
      );
    }) as unknown as typeof fetch;
    const wait = mock(() => Promise.resolve(undefined));
    const retryingFetch = createProdE2EFetch(fetchImpl, wait);

    const response = await retryingFetch("https://teakvault.com/api/v1/cards", {
      body: "{}",
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^.+$/);
    expect(keys[1]).toBe(keys[0]);
    expect(signals[0]).not.toBe(signals[1]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  test("does not retry permanent API failures", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(null, { status: 400 }))
    );
    const retryingFetch = createProdE2EFetch(
      fetchImpl as unknown as typeof fetch,
      mock(() => Promise.resolve(undefined))
    );

    const response = await retryingFetch("https://teakvault.com/api/v1/cards", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("preserves a caller-provided idempotency key", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(new Request(input, init).headers.get("Idempotency-Key"), {
          status: 200,
        })
      )
    ) as unknown as typeof fetch;
    const retryingFetch = createProdE2EFetch(fetchImpl);

    const response = await retryingFetch("https://teakvault.com/api/v1/cards", {
      headers: { "Idempotency-Key": "existing-key" },
      method: "POST",
    });

    expect(await response.text()).toBe("existing-key");
  });

  test("does not retry non-idempotent API writes", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(null, { status: 500 }))
    );
    const retryingFetch = createProdE2EFetch(
      fetchImpl as unknown as typeof fetch,
      mock(() => Promise.resolve(undefined))
    );

    const response = await retryingFetch(
      "https://teakvault.com/api/v1/cards/bulk",
      { method: "POST" }
    );

    expect(response.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("clones body-bearing requests for each attempt", async () => {
    const bodies: string[] = [];
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      const request = input as Request;
      bodies.push(await request.text());
      return new Response(null, { status: bodies.length === 1 ? 500 : 200 });
    }) as unknown as typeof fetch;
    const retryingFetch = createProdE2EFetch(
      fetchImpl,
      mock(() => Promise.resolve(undefined))
    );

    const response = await retryingFetch(
      new Request("https://teakvault.com/api/v1/cards", {
        body: '{"content":"retry"}',
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(bodies).toEqual(['{"content":"retry"}', '{"content":"retry"}']);
  });

  test("does not outlive the overall request deadline", async () => {
    const overall = new AbortController();
    const fetchImpl = mock(() => {
      overall.abort(new DOMException("Overall timeout", "AbortError"));
      return Promise.resolve(new Response(null, { status: 500 }));
    }) as unknown as typeof fetch;
    const retryingFetch = createProdE2EFetch(
      fetchImpl,
      mock(() => Promise.resolve(undefined))
    );

    await expect(
      retryingFetch("https://teakvault.com/api/v1/cards", {
        method: "POST",
        signal: overall.signal,
      })
    ).rejects.toThrow("Overall timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("stops a retry backoff when the overall deadline expires", async () => {
    const overall = new AbortController();
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(null, { status: 500 }))
    ) as unknown as typeof fetch;
    const wait = mock(() => {
      overall.abort(new DOMException("Overall timeout", "AbortError"));
      return new Promise<never>(() => undefined);
    });
    const retryingFetch = createProdE2EFetch(fetchImpl, wait);

    await expect(
      retryingFetch("https://teakvault.com/api/v1/cards", {
        method: "POST",
        signal: overall.signal,
      })
    ).rejects.toThrow("Overall timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});

describe("production E2E navigation retries", () => {
  test.each([
    "page.goto: NS_BINDING_ABORTED; maybe frame was detached?",
    "page.goto: net::ERR_ABORTED at https://app.teakvault.com/settings",
    "page.goto: Navigation failed because frame was detached",
  ])("retries an aborted navigation: %s", async (message) => {
    const goto = mock(() => Promise.resolve(undefined));
    goto.mockImplementationOnce(() => Promise.reject(new Error(message)));
    const wait = mock(() => Promise.resolve(undefined));

    await gotoApp({ goto } as unknown as Page, "/settings", wait);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  test("does not retry other navigation errors", async () => {
    const goto = mock(() =>
      Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED"))
    );
    const wait = mock(() => Promise.resolve(undefined));

    await expect(
      gotoApp({ goto } as unknown as Page, "/settings", wait)
    ).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
    expect(goto).toHaveBeenCalledTimes(1);
  });

  test("gives up after three aborted attempts", async () => {
    const goto = mock(() => Promise.reject(new Error("NS_BINDING_ABORTED")));

    await expect(
      gotoApp({ goto } as unknown as Page, "/login", () => Promise.resolve())
    ).rejects.toThrow("NS_BINDING_ABORTED");
    expect(goto).toHaveBeenCalledTimes(3);
  });
});

describe("retryClickUntil", () => {
  test("does not click when the condition already holds", async () => {
    const attempt = mock(() => Promise.resolve(undefined));

    await expect(
      retryClickUntil(() => Promise.resolve(true), attempt)
    ).resolves.toBe(true);
    expect(attempt).not.toHaveBeenCalled();
  });

  test("retries the click until the condition holds", async () => {
    let clicks = 0;
    const attempt = mock(() => {
      clicks += 1;
      return Promise.resolve(undefined);
    });

    await expect(
      retryClickUntil(() => Promise.resolve(clicks >= 2), attempt)
    ).resolves.toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  test("stops after the attempt limit and reports failure", async () => {
    const attempt = mock(() => Promise.resolve(undefined));

    await expect(
      retryClickUntil(() => Promise.resolve(false), attempt)
    ).resolves.toBe(false);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
