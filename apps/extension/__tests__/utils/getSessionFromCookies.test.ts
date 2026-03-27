// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  getSessionTokenFromCookies,
  hasValidSession,
} from "../../utils/getSessionFromCookies";

describe("getSessionTokenFromCookies", () => {
  const mockGet = mock();

  beforeEach(() => {
    mockGet.mockReset();
    globalThis.chrome = {
      cookies: {
        get: mockGet,
      },
    };
  });

  test("reads the Clerk session cookie", async () => {
    mockGet.mockResolvedValue({
      name: "__session",
      value: "session-token-123",
    });

    const token = await getSessionTokenFromCookies();

    expect(token).toBe("session-token-123");
    expect(mockGet).toHaveBeenCalledWith({
      url: "https://app.teakvault.com",
      name: "__session",
    });
  });

  test("returns null when the session cookie is missing", async () => {
    mockGet.mockResolvedValue(null);

    expect(await getSessionTokenFromCookies()).toBeNull();
  });

  test("returns null when cookie access throws", async () => {
    mockGet.mockRejectedValue(new Error("Cookie access failed"));

    expect(await getSessionTokenFromCookies()).toBeNull();
  });

  test("hasValidSession reflects the session token result", async () => {
    mockGet.mockResolvedValueOnce({ name: "__session", value: "token" });
    expect(await hasValidSession()).toBe(true);

    mockGet.mockResolvedValueOnce(null);
    expect(await hasValidSession()).toBe(false);
  });
});
