import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fetchAuthMutation = mock();
const isAuthenticated = mock();

mock.module("@/lib/auth-server", () => ({
  fetchAuthMutation,
  getToken: mock(),
  handler: mock(),
  isAuthenticated,
}));

const { POST } = await import("../app/native/auth/approve/route");

const pairingFields = {
  code_challenge: "a".repeat(43),
  device_id: "desktop-device-123456",
  redirect_uri: "https://app.teakvault.com/native/auth/complete",
  state: "state_123456789012",
  surface: "desktop",
};

const pairingBody = () => new URLSearchParams(pairingFields);

const postApprove = (init?: {
  body?: URLSearchParams;
  headers?: HeadersInit;
}) =>
  POST(
    new Request("https://app.teakvault.com/native/auth/approve", {
      body: init?.body ?? pairingBody(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://app.teakvault.com",
        "sec-fetch-site": "same-origin",
        ...init?.headers,
      },
      method: "POST",
    })
  );

describe("native auth routes", () => {
  beforeEach(() => {
    fetchAuthMutation.mockReset();
    isAuthenticated.mockReset();
  });

  test("start page reviews pairing and posts approval instead of minting on GET", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/start/page.tsx"),
      "utf8"
    );

    expect(source).toContain('method="post"');
    expect(source).toContain("Approve device");
    expect(source).toContain("/native/auth/approve");
    expect(source).not.toContain("createNativeAuthCode");
  });

  test("rejects cross-site approval without creating a native auth code", async () => {
    const response = await postApprove({
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    const payload = (await response.json()) as { code?: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe("CROSS_SITE_BLOCKED");
    expect(fetchAuthMutation).not.toHaveBeenCalled();
  });

  test("rejects invalid pairing payloads without creating a native auth code", async () => {
    isAuthenticated.mockResolvedValue(true);
    const response = await postApprove({
      body: new URLSearchParams({ ...pairingFields, device_id: "short" }),
    });
    const payload = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("INVALID_NATIVE_AUTH_REQUEST");
    expect(fetchAuthMutation).not.toHaveBeenCalled();
  });

  test("unauthenticated approval preserves pairing state on the login redirect", async () => {
    isAuthenticated.mockResolvedValue(false);
    const response = await postApprove();
    const location = response.headers.get("location") ?? "";
    const next = new URL(location).searchParams.get("next") ?? "";

    expect(response.status).toBe(307);
    expect(fetchAuthMutation).not.toHaveBeenCalled();
    expect(next).toContain("/native/auth/start");
    expect(next).toContain(pairingFields.device_id);
    expect(next).toContain(pairingFields.state);
  });

  test("authenticated same-origin approval creates the code and redirects to completion", async () => {
    isAuthenticated.mockResolvedValue(true);
    fetchAuthMutation.mockResolvedValue(undefined);
    const response = await postApprove();

    expect(fetchAuthMutation).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.teakvault.com/native/auth/complete?state=state_123456789012&surface=desktop"
    );
  });

  test("keeps pairing state when code creation fails", async () => {
    isAuthenticated.mockResolvedValue(true);
    fetchAuthMutation.mockRejectedValue(new Error("mint failed"));
    const response = await postApprove();
    const location = response.headers.get("location") ?? "";
    const next = new URL(location).searchParams.get("next") ?? "";

    expect(response.status).toBe(307);
    expect(next).toContain("/native/auth/start");
    expect(next).toContain(pairingFields.device_id);
    expect(next).not.toBe("/native/auth/start");
  });

  test("completion page tailors copy for the browser extension surface", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/complete/page.tsx"),
      "utf8"
    );

    expect(source).toContain("useSearchParams");
    expect(source).toContain('"browser-extension"');
    expect(source).toContain("Teak icon");
  });

  test("middleware allows native auth handoff routes through", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).toContain('startsWith("/native/auth")');
  });
});
