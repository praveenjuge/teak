// @ts-nocheck
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

const startActiveSpan = mock(
  async (
    _name: string,
    _options: unknown,
    callback: (span: {
      end: () => void;
      recordException: (error: unknown) => void;
      setAttribute: (name: string, value: unknown) => void;
      setStatus: (status: unknown) => void;
    }) => Promise<unknown>
  ) =>
    await callback({
      end: spanEnd,
      recordException: spanRecordException,
      setAttribute: spanSetAttribute,
      setStatus: spanSetStatus,
    })
);
const spanEnd = mock();
const spanRecordException = mock();
const spanSetAttribute = mock();
const spanSetStatus = mock();
const sentryInit = mock();
const sentryFlush = mock(async () => true);
const sentryCaptureException = mock();
const sentryCaptureCheckIn = mock(() => "check-in-123");
const sentryMetricCount = mock();
const sentryMetricDistribution = mock();
const sentryMetricGauge = mock();
const sentryLogInfo = mock();
const sentryLogError = mock();
const sentryVercelAiIntegration = mock((options: unknown) => ({
  name: "VercelAI",
  options,
}));
const sentryConsoleLoggingIntegration = mock((options: unknown) => ({
  name: "ConsoleLogging",
  options,
}));

mock.module("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: {
    getActiveSpan: () => ({ setAttribute: spanSetAttribute }),
    getTracer: () => ({ startActiveSpan }),
  },
}));

mock.module("@sentry/node", () => ({
  captureCheckIn: sentryCaptureCheckIn,
  consoleLoggingIntegration: sentryConsoleLoggingIntegration,
  captureException: sentryCaptureException,
  flush: sentryFlush,
  init: sentryInit,
  logger: {
    error: sentryLogError,
    info: sentryLogInfo,
  },
  metrics: {
    count: sentryMetricCount,
    distribution: sentryMetricDistribution,
    gauge: sentryMetricGauge,
  },
  validateOpenTelemetrySetup: mock(),
  vercelAIIntegration: sentryVercelAiIntegration,
}));

const originalEnvironment = { ...process.env };
let telemetry: typeof import("../../telemetry/sentry");

beforeAll(async () => {
  process.env.SENTRY_BACKEND_DSN = "https://public@example.invalid/1";
  process.env.SENTRY_ENVIRONMENT = "production";
  process.env.CONVEX_GIT_COMMIT_SHA =
    "abcdef0123456789abcdef0123456789abcdef01";
  telemetry = await import("../../telemetry/sentry");
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  process.env.SENTRY_BACKEND_DSN = "https://public@example.invalid/1";
  process.env.SENTRY_ENVIRONMENT = "production";
  process.env.CONVEX_GIT_COMMIT_SHA =
    "abcdef0123456789abcdef0123456789abcdef01";
  for (const fn of [
    sentryFlush,
    sentryCaptureException,
    sentryCaptureCheckIn,
    sentryMetricCount,
    sentryMetricDistribution,
    sentryMetricGauge,
    sentryLogInfo,
    sentryLogError,
    spanEnd,
    spanRecordException,
    spanSetAttribute,
    spanSetStatus,
    startActiveSpan,
  ]) {
    fn.mockClear();
  }
});

describe("backend Sentry OpenTelemetry", () => {
  test("falls back from an empty explicit release", () => {
    process.env.SENTRY_RELEASE = "  ";

    expect(telemetry.resolveBackendRelease()).toBe(
      "teak-backend@abcdef0123456789abcdef0123456789abcdef01"
    );
  });

  test("initializes full AI monitoring with streaming and scrubbing", () => {
    expect(telemetry.ensureBackendTelemetry()).toBe(true);
    expect(sentryInit).toHaveBeenCalledTimes(1);
    expect(sentryVercelAiIntegration).toHaveBeenCalledWith({
      enableTruncation: false,
      force: true,
      recordInputs: false,
      recordOutputs: false,
    });
    expect(sentryConsoleLoggingIntegration).toHaveBeenCalledWith({
      levels: ["log", "warn", "error"],
    });
    const options = sentryInit.mock.calls[0]?.[0] as {
      beforeSendSpan: (span: { data: Record<string, unknown> }) => {
        data: Record<string, unknown>;
      };
      release: string;
      streamGenAiSpans: boolean;
    };
    expect(options.release).toBe(
      "teak-backend@abcdef0123456789abcdef0123456789abcdef01"
    );
    expect(options.streamGenAiSpans).toBe(true);

    const span = options.beforeSendSpan({
      data: {
        "gen_ai.request.messages": `${"a".repeat(17_000)}\nTOKEN=secret`,
      },
    });
    expect(span.data["gen_ai.request.messages"]).not.toContain("secret");
    expect(span.data["gen_ai.request.messages.content.truncated"]).toBe(true);
    expect(
      span.data["gen_ai.request.messages.content.original_length"]
    ).toBeGreaterThan(17_000);
    expect(span.data["gen_ai.request.messages.content.sha256"]).toMatch(
      /^[a-f0-9]{64}$/u
    );
  });

  test("records AI content only through the scrubbed explicit span path", () => {
    telemetry.recordBackendAiContent({
      prompt: "Private note for planning TOKEN=secret person@example.com",
      response: "Generated private summary",
      system: "Follow the system instructions",
    });

    const attributes = Object.fromEntries(spanSetAttribute.mock.calls);
    expect(attributes["gen_ai.request.prompt"]).toContain(
      "Private note for planning"
    );
    expect(attributes["gen_ai.request.prompt"]).not.toContain("secret");
    expect(attributes["gen_ai.request.prompt"]).not.toContain(
      "person@example.com"
    );
    expect(attributes["gen_ai.request.system"]).toBe(
      "Follow the system instructions"
    );
    expect(attributes["gen_ai.response.text"]).toBe(
      "Generated private summary"
    );
  });

  test("exports a successful semantic span and flushes the action boundary", async () => {
    const result = await telemetry.withBackendSpan(
      {
        attributes: { "card.type": "link" },
        cardId: "card-123",
        name: "card.processing",
        operation: "teak.workflow",
        stage: "classification",
        surface: "backend",
        userId: "user-123",
      },
      async () => "complete"
    );

    expect(result).toBe("complete");
    expect(startActiveSpan).toHaveBeenCalledTimes(1);
    const options = startActiveSpan.mock.calls[0]?.[1] as {
      attributes: Record<string, string>;
    };
    expect(options.attributes["sentry.op"]).toBe("teak.workflow");
    expect(JSON.stringify(options.attributes)).not.toContain("card-123");
    expect(JSON.stringify(options.attributes)).not.toContain("user-123");
    expect(spanSetAttribute).toHaveBeenCalledWith("outcome", "success");
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 1 });
    expect(sentryMetricDistribution).toHaveBeenCalledWith(
      "teak.workflow.stage.duration",
      expect.any(Number),
      expect.objectContaining({ unit: "millisecond" })
    );
    expect(spanEnd).toHaveBeenCalledTimes(1);
    expect(sentryFlush).toHaveBeenCalledWith(2000);
  });

  test("captures application failures without changing the thrown error", async () => {
    const applicationError = new Error("Groq generation failed");

    await expect(
      telemetry.withBackendSpan(
        {
          name: "ai.metadata",
          operation: "gen_ai.generate",
          stage: "ai_metadata",
          surface: "backend",
        },
        () => Promise.reject(applicationError)
      )
    ).rejects.toBe(applicationError);

    expect(spanRecordException).toHaveBeenCalledWith(applicationError);
    expect(spanSetAttribute).toHaveBeenCalledWith("outcome", "failure");
    expect(spanSetAttribute).toHaveBeenCalledWith("retryable", false);
    expect(spanSetStatus).toHaveBeenCalledWith({
      code: 2,
      message: "ProviderError",
    });
    const captureContext = sentryCaptureException.mock.calls[0]?.[1] as {
      tags: Record<string, string>;
    };
    expect(sentryCaptureException.mock.calls[0]?.[0]).toBe(applicationError);
    expect(captureContext.tags["error.class"]).toBe("ProviderError");
    expect(
      sentryMetricCount.mock.calls.some(
        ([metric]) => metric === "teak.workflow.failure"
      )
    ).toBe(false);
    expect(sentryFlush).toHaveBeenCalled();
  });

  test("counts a thrown workflow failure exactly once", async () => {
    const workflowError = new Error("workflow step failed");

    await expect(
      telemetry.withBackendSpan(
        {
          name: "card.classification",
          operation: "teak.workflow.step",
          stage: "classification",
          surface: "backend",
        },
        () => Promise.reject(workflowError)
      )
    ).rejects.toBe(workflowError);

    expect(
      sentryMetricCount.mock.calls.filter(
        ([metric]) => metric === "teak.workflow.failure"
      )
    ).toHaveLength(1);
  });

  test("keeps handled non-workflow failures out of workflow metrics", () => {
    const importError = new Error("import rejected");

    telemetry.recordBackendHandledFailure(importError, {
      operation: "import",
      stage: "import",
    });

    expect(sentryCaptureException).toHaveBeenCalledWith(
      importError,
      expect.objectContaining({
        tags: expect.objectContaining({ operation: "import" }),
      })
    );
    expect(sentryLogError).toHaveBeenCalledWith(
      "telemetry.operation.handled_failure",
      expect.objectContaining({ operation: "import", outcome: "failure" })
    );
    expect(sentryMetricCount).not.toHaveBeenCalled();
  });

  test("counts handled workflow failures exactly once", () => {
    telemetry.recordBackendHandledFailure(new Error("step rejected"), {
      operation: "teak.workflow.step",
      stage: "classification",
    });

    expect(
      sentryMetricCount.mock.calls.filter(
        ([metric]) => metric === "teak.workflow.failure"
      )
    ).toHaveLength(1);
  });

  test("records canonical outcomes without raw identifiers", async () => {
    const sent = await telemetry.recordBackendOutcome({
      cardId: "card-123",
      metric: "teak.card.create.success",
      operation: "teak.card.create",
      outcome: "success",
      stage: "creation",
      surface: "web",
      userId: "user-123",
    });

    expect(sent).toBe(true);
    expect(sentryMetricCount).toHaveBeenCalledTimes(1);
    const attributes = sentryMetricCount.mock.calls[0]?.[2] as {
      attributes: Record<string, unknown>;
    };
    expect(JSON.stringify(attributes)).not.toContain("card-123");
    expect(JSON.stringify(attributes)).not.toContain("user-123");
    expect(attributes.attributes.origin).toBe("web");
    expect(startActiveSpan).toHaveBeenCalledTimes(1);
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 1 });
  });

  test("marks canonical failure outcomes as failed spans", async () => {
    await telemetry.recordBackendOutcome({
      metric: "teak.card.create.failure",
      operation: "teak.workflow.step",
      outcome: "failure",
      stage: "creation",
      surface: "mobile",
    });

    expect(spanSetStatus).toHaveBeenCalledWith({ code: 2 });
    expect(sentryLogError).toHaveBeenCalledWith(
      "teak.card.create.failure",
      expect.objectContaining({ outcome: "failure", origin: "mobile" })
    );
  });

  test("emits cron start and completion check-ins around the original result", async () => {
    const result = await telemetry.withCronCheckIn(
      {
        checkinMarginMinutes: 5,
        maxRuntimeMinutes: 10,
        schedule: "0 * * * *",
        slug: "hourly-test",
      },
      async () => "done"
    );

    expect(result).toBe("done");
    expect(sentryCaptureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "hourly-test", status: "in_progress" },
      expect.objectContaining({
        schedule: { type: "crontab", value: "0 * * * *" },
        timezone: "UTC",
      })
    );
    expect(sentryCaptureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkInId: "check-in-123",
        monitorSlug: "hourly-test",
        status: "ok",
      })
    );
  });

  test("reports cron failures and preserves the thrown application error", async () => {
    const error = new Error("cron failed");
    await expect(
      telemetry.withCronCheckIn(
        {
          checkinMarginMinutes: 5,
          maxRuntimeMinutes: 10,
          schedule: "0 * * * *",
          slug: "hourly-test",
        },
        () => Promise.reject(error)
      )
    ).rejects.toBe(error);

    expect(sentryCaptureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        checkInId: "check-in-123",
        monitorSlug: "hourly-test",
        status: "error",
      })
    );
  });
});
