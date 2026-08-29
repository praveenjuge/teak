import { describe, expect, test } from "bun:test";
import { DEFAULT_TEAK_DEV_APP_URL } from "@teak/convex/dev-urls";
import {
  isSameOriginPost,
  nativeAuthCompletionUrl,
  parseNativeAuthRequest,
} from "@/lib/native-auth-request";

const validRequest = {
  codeChallenge: "a".repeat(43),
  deviceId: "desktop-device-123456",
  redirectUri: "https://app.teakvault.com/native/auth/complete",
  state: "state_123456789012",
  surface: "desktop",
};

describe("parseNativeAuthRequest", () => {
  test("accepts a well-formed pairing request", () => {
    expect(parseNativeAuthRequest(validRequest)).toMatchObject({
      deviceId: validRequest.deviceId,
      surface: "desktop",
    });
  });

  test("accepts the local completion redirect", () => {
    expect(
      parseNativeAuthRequest({
        ...validRequest,
        redirectUri: `${DEFAULT_TEAK_DEV_APP_URL}/native/auth/complete`,
      })
    ).not.toBeNull();
  });

  test("rejects attacker-controlled completion redirects", () => {
    expect(
      parseNativeAuthRequest({
        ...validRequest,
        redirectUri: "https://evil.example/native/auth/complete",
      })
    ).toBeNull();
  });

  test("rejects malformed pairing parameters", () => {
    expect(
      parseNativeAuthRequest({ ...validRequest, deviceId: "short" })
    ).toBeNull();
    expect(
      parseNativeAuthRequest({ ...validRequest, surface: "watchos" })
    ).toBeNull();
  });
});

describe("isSameOriginPost", () => {
  const requestUrl = new URL("https://app.teakvault.com/native/auth/approve");

  test("rejects cross-site pairing approvals", () => {
    const request = new Request(requestUrl, {
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      method: "POST",
    });

    expect(isSameOriginPost(request, requestUrl)).toBe(false);
  });

  test("rejects approvals that omit Origin", () => {
    const request = new Request(requestUrl, { method: "POST" });
    expect(isSameOriginPost(request, requestUrl)).toBe(false);
  });

  test("accepts same-origin form posts", () => {
    const request = new Request(requestUrl, {
      headers: {
        origin: "https://app.teakvault.com",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });

    expect(isSameOriginPost(request, requestUrl)).toBe(true);
  });
});

describe("nativeAuthCompletionUrl", () => {
  test("appends state and surface after approval", () => {
    const parsed = parseNativeAuthRequest(validRequest);
    expect(parsed).not.toBeNull();
    if (!parsed) {
      return;
    }

    const completion = new URL(nativeAuthCompletionUrl(parsed));
    expect(completion.searchParams.get("state")).toBe(validRequest.state);
    expect(completion.searchParams.get("surface")).toBe("desktop");
  });
});
