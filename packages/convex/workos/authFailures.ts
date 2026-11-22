import {
  SIGNUP_METHODS,
  type SignupMethod,
  signupMethodFromWorkos,
} from "../shared/analytics";
import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import { scrubTelemetryString } from "../shared/telemetry";
import { workosRequest } from "./client";

/**
 * WorkOS's failed sign-in events. A failure at the identity provider, such as
 * Apple's response WorkOS can't read, ends on WorkOS's hosted page and never
 * reaches Teak, so WorkOS's event log is the only place every failure shows.
 */
const FAILED_EVENTS = [
  "authentication.oauth_failed",
  "authentication.password_failed",
  "authentication.magic_auth_failed",
  "authentication.sso_failed",
].join(",");

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const MAX_MESSAGE_LENGTH = 120;

export type DeviceOs =
  | "ios"
  | "android"
  | "macos"
  | "windows"
  | "linux"
  | "other"
  | "none";

export interface AuthFailure {
  createdAt: string;
  /** WorkOS's code, such as `oauth_failed`. */
  errorCode: string;
  /** WorkOS's message, scrubbed of addresses and secrets. */
  errorMessage: string;
  eventId: string;
  method: SignupMethod;
  /** From the browser's user agent; `none` when WorkOS saw no browser. */
  os: DeviceOs;
}

export const deviceOs = (userAgent: unknown): DeviceOs => {
  if (typeof userAgent !== "string" || !userAgent) {
    return "none";
  }
  if (/iPhone|iPad|iPod/u.test(userAgent)) {
    return "ios";
  }
  if (/Android/u.test(userAgent)) {
    return "android";
  }
  if (/Macintosh|Mac OS X/u.test(userAgent)) {
    return "macos";
  }
  if (/Windows/u.test(userAgent)) {
    return "windows";
  }
  if (/Linux|CrOS/u.test(userAgent)) {
    return "linux";
  }
  return "other";
};

const failureMethod = (type: unknown, provider: unknown): SignupMethod => {
  if (typeof provider === "string" && provider) {
    return signupMethodFromWorkos(provider) ?? "other";
  }
  return SIGNUP_METHODS.find((method) => method === type) ?? "other";
};

const parseFailure = (value: unknown): AuthFailure | null => {
  const event = value as {
    created_at?: unknown;
    data?: {
      error?: { code?: unknown; message?: unknown };
      provider?: unknown;
      type?: unknown;
      user_agent?: unknown;
    };
    id?: unknown;
  } | null;
  if (typeof event?.id !== "string" || typeof event.created_at !== "string") {
    return null;
  }
  const error = event.data?.error;
  return {
    eventId: event.id,
    createdAt: event.created_at,
    method: failureMethod(event.data?.type, event.data?.provider),
    errorCode: typeof error?.code === "string" ? error.code : "unknown",
    errorMessage:
      typeof error?.message === "string"
        ? scrubTelemetryString(error.message).slice(0, MAX_MESSAGE_LENGTH)
        : "",
    os: deviceOs(event.data?.user_agent),
  };
};

/** Failed sign-ins WorkOS recorded from `rangeStart` up to `rangeEnd`. */
export async function listWorkosAuthFailures(
  rangeStart: Date,
  rangeEnd: Date
): Promise<AuthFailure[]> {
  const failures: AuthFailure[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // WorkOS takes either `range_start` or an `after` cursor, not both.
    const response = await workosRequest("/events", {
      query: {
        events: FAILED_EVENTS,
        limit: String(PAGE_LIMIT),
        range_end: rangeEnd.toISOString(),
        ...(after ? { after } : { range_start: rangeStart.toISOString() }),
      },
    });
    if (!response.ok) {
      throw new Error(`workos_events_${response.status}`);
    }
    const body = await readResponseTextWithinLimit(response, 1024 * 1024);
    const payload = body
      ? (JSON.parse(body) as {
          data?: unknown;
          list_metadata?: { after?: unknown };
        })
      : null;
    if (!Array.isArray(payload?.data)) {
      throw new Error("workos_events_invalid");
    }
    for (const event of payload.data) {
      const failure = parseFailure(event);
      if (failure) {
        failures.push(failure);
      }
    }
    const next = payload.list_metadata?.after;
    if (
      typeof next !== "string" ||
      !next ||
      next === after ||
      payload.data.length < PAGE_LIMIT
    ) {
      break;
    }
    after = next;
  }
  return failures;
}
