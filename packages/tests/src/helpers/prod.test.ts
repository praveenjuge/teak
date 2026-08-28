import { describe, expect, mock, test } from "bun:test";
import { createProdE2EFetch } from "./prod";

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
});
