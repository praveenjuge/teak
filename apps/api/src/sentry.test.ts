import { describe, expect, mock, test } from "bun:test";

const captureException = mock();
const count = mock();
const gauge = mock();
const distribution = mock();
const setTag = mock();
const setContext = mock();

mock.module("@sentry/node", () => ({
  captureException,
  metrics: { count, gauge, distribution },
  startSpan: async (_options: unknown, callback: () => Promise<void>) =>
    callback(),
  withIsolationScope: async (
    callback: (scope: {
      setTag: typeof setTag;
      setContext: typeof setContext;
    }) => Promise<void>
  ) => callback({ setTag, setContext }),
}));

const { sentryMetricsRecorder, sentryRequestMiddleware } = await import(
  "./sentry"
);

const createContext = () => ({
  req: {
    method: "GET",
    url: "https://api.teakvault.com/v1/cards",
    raw: new Request("https://api.teakvault.com/v1/cards", {
      headers: {
        Authorization: "Bearer secret",
        "User-Agent": "test",
      },
    }),
  },
  res: {
    status: 200,
    headers: new Headers(),
  },
});

describe("apps/api sentry helpers", () => {
  test("records metrics through Sentry", () => {
    sentryMetricsRecorder.count("api.test", 1, { surface: "api" });
    sentryMetricsRecorder.gauge("api.gauge", 2, {}, "none");
    sentryMetricsRecorder.distribution("api.latency", 3, {}, "millisecond");

    expect(count).toHaveBeenCalledWith("api.test", 1, {
      attributes: { surface: "api" },
    });
    expect(gauge).toHaveBeenCalled();
    expect(distribution).toHaveBeenCalled();
  });

  test("adds request context and strips sensitive headers", async () => {
    const c = createContext();
    const next = mock().mockResolvedValue(undefined);

    await sentryRequestMiddleware(c as any, next);

    expect(next).toHaveBeenCalled();
    expect(c.res.headers.get("x-request-id")).toBeTruthy();
    expect(setContext).toHaveBeenCalledWith(
      "request",
      expect.objectContaining({
        headers: { "user-agent": "test" },
      })
    );
  });

  test("captures thrown request errors", async () => {
    const c = createContext();
    const error = new Error("boom");

    await expect(
      sentryRequestMiddleware(c as any, () => {
        throw error;
      })
    ).rejects.toThrow("boom");

    expect(captureException).toHaveBeenCalledWith(error);
  });
});
