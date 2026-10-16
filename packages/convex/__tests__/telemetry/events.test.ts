import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { emitCardOutcome, emitUserCreated } from "../../telemetry/events";
import {
  asFetch,
  handlerOf,
  mockActionCtx,
} from "../helpers/convex.test-utils";

const originalFetch = globalThis.fetch;
const originalToken = process.env.POSTHOG_PROJECT_TOKEN;
let fetchMock: ReturnType<typeof mock>;

const sentEvents = () =>
  fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).batch);

beforeEach(() => {
  fetchMock = mock(async () => Response.json({ status: 1 }));
  globalThis.fetch = asFetch(fetchMock);
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) {
    delete process.env.POSTHOG_PROJECT_TOKEN;
  } else {
    process.env.POSTHOG_PROJECT_TOKEN = originalToken;
  }
});

describe("server product events", () => {
  test("maps card outcomes to created and failed events", async () => {
    await handlerOf(emitCardOutcome)(mockActionCtx({}), {
      cardType: "link",
      outcome: "success",
      source: "api",
      userId: "u1",
    });
    await handlerOf(emitCardOutcome)(mockActionCtx({}), {
      errorClass: "ValidationError",
      outcome: "failure",
      userId: "u1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      sentEvents().map(({ distinct_id, event, properties }) => ({
        distinct_id,
        event,
        card_type: properties.card_type,
        error_class: properties.error_class,
        source: properties.source,
      }))
    ).toEqual([
      {
        card_type: "link",
        distinct_id: "u1",
        error_class: undefined,
        event: "card_created",
        source: "api",
      },
      {
        card_type: "unknown",
        distinct_id: "u1",
        error_class: "ValidationError",
        event: "card_create_failed",
        source: "unknown",
      },
    ]);
  });

  test("identifies a new account with its email and free plan", async () => {
    await handlerOf(emitUserCreated)(mockActionCtx({}), {
      email: "new@example.com",
      source: "auth",
      userId: "teak_u2",
    });

    const [event] = sentEvents();
    expect(event).toMatchObject({
      distinct_id: "teak_u2",
      event: "user_signed_up",
      properties: {
        $set: { email: "new@example.com", plan: "free" },
        source: "auth",
      },
    });
    expect(event.properties.$set.signed_up_at).toEqual(expect.any(String));
  });
});
