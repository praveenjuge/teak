import { describe, expect, test } from "bun:test";
import { type SessionStorage, WorkosSession } from "../../lib/workos-session";

// Failure modes: corrupt/wrong-deployment cache, unavailable Keychain, invalid
// issuer/user/session/expiry, offline refresh, expired credentials, simultaneous
// rotation, failed persistence, and sign-out/new login racing in-flight work.
const clientId = "client_TEST";
const key = `teak.authkit.${clientId}`;
const verifier = "v".repeat(43);
const defaultExpiry = Date.now() + 120_000;
function response(refresh = "refresh-1", expiry = defaultExpiry) {
  const claims = {
    iss: `https://api.workos.com/user_management/${clientId}`,
    sub: "user_ONE",
    sid: "session_ONE",
    exp: Math.floor(expiry / 1000),
  };
  return {
    access_token: `header.${btoa(JSON.stringify(claims))}.signature`,
    refresh_token: refresh,
    user: {
      id: "user_ONE",
      email: "hello@example.com",
      email_verified: true,
      external_id: "permanent-vault",
      first_name: "Praveen",
      last_name: "Juge",
    },
    oauth_tokens: { access_token: "unneeded-provider-token" },
  };
}
function store(initial: string | null = null) {
  const data = new Map<string, string>();
  if (initial !== null) {
    data.set(key, initial);
  }
  const storage: SessionStorage = {
    getItemAsync: (k) => Promise.resolve(data.get(k) ?? null),
    setItemAsync: (k, value) => {
      data.set(k, value);
      return Promise.resolve();
    },
    deleteItemAsync: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
  return { data, storage };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const transport: typeof fetch = () =>
  Promise.resolve(Response.json(response()));

describe("native AuthKit session", () => {
  test("exchanges public PKCE, persists minimal credentials, and restores the permanent user", async () => {
    const s = store();
    const http: typeof fetch = (_url, init) => {
      expect(String(_url)).toBe(
        "https://api.workos.com/user_management/authenticate"
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        client_id: clientId,
        grant_type: "authorization_code",
        code: "code",
        code_verifier: verifier,
      });
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      return transport(_url, init);
    };
    const session = new WorkosSession(clientId, s.storage, http);
    expect(await session.exchangeCode("code", verifier)).toBe(
      response().access_token
    );
    expect(s.data.get(key)).not.toContain("unneeded-provider-token");
    const restored = new WorkosSession(clientId, s.storage, http);
    await restored.hydrate();
    expect(restored.getSnapshot()).toMatchObject({
      isLoading: false,
      user: { teakUserId: "permanent-vault", name: "Praveen Juge" },
    });
    expect(await restored.fetchAccessToken()).toBe(response().access_token);
  });
  test.each([
    "{",
    "x".repeat(65_537),
    JSON.stringify({ clientId: "client_OTHER", response: response() }),
  ])("discards invalid cache", async (initial: string) => {
    const s = store(initial);
    const session = new WorkosSession(clientId, s.storage, transport);
    await session.hydrate();
    expect(session.getSnapshot()).toEqual({ isLoading: false, user: null });
    expect(s.data.has(key)).toBe(false);
  });
  test("Keychain read failure preserves the credential and can recover", async () => {
    const s = store(JSON.stringify({ clientId, response: response() }));
    let offline = true;
    const storage = {
      ...s.storage,
      getItemAsync: (k: string) =>
        offline
          ? Promise.reject(new Error("Keychain locked"))
          : s.storage.getItemAsync(k),
    };
    const session = new WorkosSession(clientId, storage, transport);
    await expect(session.hydrate()).rejects.toThrow("Keychain locked");
    expect(s.data.has(key)).toBe(true);
    offline = false;
    await session.hydrate();
    expect(session.getSnapshot().user?.teakUserId).toBe("permanent-vault");
  });
  test("concurrent refresh rotates once and persists before publishing", async () => {
    const s = store(
      JSON.stringify({ clientId, response: response("old", Date.now() - 1000) })
    );
    const request = deferred<Response>();
    const started = deferred<void>();
    let calls = 0;
    const http: typeof fetch = (_url, init) => {
      calls += 1;
      expect(JSON.parse(String(init?.body)).refresh_token).toBe("old");
      started.resolve();
      return request.promise;
    };
    const session = new WorkosSession(clientId, s.storage, http);
    const a = session.fetchAccessToken();
    const b = session.fetchAccessToken({ forceRefreshToken: true });
    await started.promise;
    request.resolve(Response.json(response("rotated")));
    expect(await a).toBe(await b);
    expect(calls).toBe(1);
    expect(s.data.get(key)).toContain("rotated");
  });
  test("offline expiry never returns an expired token and reconnect refreshes", async () => {
    const initial = JSON.stringify({
      clientId,
      response: response("old", Date.now() - 1000),
    });
    const s = store(initial);
    let offline = true;
    const http: typeof fetch = () =>
      offline
        ? Promise.reject(new Error("Offline"))
        : Promise.resolve(Response.json(response("rotated")));
    const session = new WorkosSession(clientId, s.storage, http);
    await expect(session.fetchAccessToken()).rejects.toThrow("Offline");
    expect(s.data.get(key)).toBe(initial);
    offline = false;
    expect(await session.fetchAccessToken()).toBe(response().access_token);
    expect(s.data.get(key)).toContain("rotated");
  });
  test.each(["code", "error"])(
    "revoked refresh (%s) clears memory and secure storage",
    async (field: string) => {
      const s = store(
        JSON.stringify({
          clientId,
          response: response("old", Date.now() - 1000),
        })
      );
      const http: typeof fetch = () =>
        Promise.resolve(
          Response.json({ [field]: "invalid_grant" }, { status: 400 })
        );
      const session = new WorkosSession(clientId, s.storage, http);
      expect(await session.fetchAccessToken()).toBeNull();
      expect(session.getSnapshot().user).toBeNull();
      expect(s.data.has(key)).toBe(false);
    }
  );
  test("a canceled sign-in attempt cannot exchange after sign-out", async () => {
    const s = store();
    let calls = 0;
    const http: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(Response.json(response()));
    };
    const session = new WorkosSession(clientId, s.storage, http);
    await session.hydrate();
    const attempt = session.beginSignIn();
    await session.clear();
    expect(await session.exchangeCode("code", verifier, attempt)).toBeNull();
    expect(calls).toBe(0);
    expect(s.data.has(key)).toBe(false);
  });
  test("refresh cannot replace the signed-in vault identity", async () => {
    const initial = JSON.stringify({
      clientId,
      response: response("old", Date.now() - 1000),
    });
    const s = store(initial);
    const raw = response("rotated");
    const claims = JSON.parse(atob(raw.access_token.split(".")[1]));
    claims.sub = "user_OTHER";
    raw.user.id = "user_OTHER";
    raw.access_token = `header.${btoa(JSON.stringify(claims))}.signature`;
    const http: typeof fetch = () => Promise.resolve(Response.json(raw));
    const session = new WorkosSession(clientId, s.storage, http);
    await expect(session.fetchAccessToken()).rejects.toThrow(
      "Session identity changed"
    );
    expect(s.data.get(key)).toBe(initial);
    expect(session.getSnapshot().user?.id).toBe("user_ONE");
  });

  test("opening then canceling sign-in preserves an in-flight rotation", async () => {
    const s = store(
      JSON.stringify({ clientId, response: response("old", Date.now() - 1000) })
    );
    const request = deferred<Response>();
    const started = deferred<void>();
    const http: typeof fetch = () => {
      started.resolve();
      return request.promise;
    };
    const session = new WorkosSession(clientId, s.storage, http);
    const refreshing = session.fetchAccessToken();
    await started.promise;
    session.beginSignIn();
    request.resolve(Response.json(response("rotated")));
    expect(await refreshing).not.toBeNull();
    expect(s.data.get(key)).toContain("rotated");
  });
  test("a successful newer login cannot be overwritten by an older refresh", async () => {
    const s = store(
      JSON.stringify({ clientId, response: response("old", Date.now() - 1000) })
    );
    const request = deferred<Response>();
    const started = deferred<void>();
    const http: typeof fetch = (_url, init) => {
      if (JSON.parse(String(init?.body)).grant_type === "authorization_code") {
        return Promise.resolve(Response.json(response("new-login")));
      }
      started.resolve();
      return request.promise;
    };
    const session = new WorkosSession(clientId, s.storage, http);
    const pending = session.fetchAccessToken();
    await started.promise;
    await session.exchangeCode("code", verifier);
    request.resolve(Response.json(response("old-rotation")));
    expect(await pending).toBeNull();
    expect(s.data.get(key)).toContain("new-login");
  });

  test("a late refresh cannot restore a signed-out session", async () => {
    const s = store(
      JSON.stringify({ clientId, response: response("old", Date.now() - 1000) })
    );
    const request = deferred<Response>();
    const started = deferred<void>();
    const http: typeof fetch = () => {
      started.resolve();
      return request.promise;
    };
    const session = new WorkosSession(clientId, s.storage, http);
    const pending = session.fetchAccessToken();
    await started.promise;
    expect(await session.clear()).toBe("session_ONE");
    request.resolve(Response.json(response("late")));
    expect(await pending).toBeNull();
    expect(s.data.has(key)).toBe(false);
    expect(session.getSnapshot().user).toBeNull();
  });
  test("late invalid refresh cannot clear a newer login", async () => {
    const s = store(
      JSON.stringify({ clientId, response: response("old", Date.now() - 1000) })
    );
    const request = deferred<Response>();
    const started = deferred<void>();
    const http: typeof fetch = (_url, init) => {
      if (JSON.parse(String(init?.body)).grant_type === "authorization_code") {
        return Promise.resolve(Response.json(response("new-login")));
      }
      started.resolve();
      return request.promise;
    };
    const session = new WorkosSession(clientId, s.storage, http);
    const pending = session.fetchAccessToken();
    await started.promise;
    await session.clear();
    await session.exchangeCode("code", verifier);
    request.resolve(Response.json({ code: "invalid_grant" }, { status: 400 }));
    expect(await pending).toBeNull();
    expect(s.data.get(key)).toContain("new-login");
    expect(session.getSnapshot().user?.teakUserId).toBe("permanent-vault");
  });
  test("sign-out deletes a credential whose persistence is still in flight", async () => {
    const s = store();
    const write = deferred<void>();
    const started = deferred<void>();
    const storage = {
      ...s.storage,
      setItemAsync: async (k: string, value: string) => {
        started.resolve();
        await write.promise;
        await s.storage.setItemAsync(k, value);
      },
    };
    const session = new WorkosSession(clientId, storage, transport);
    const pending = session.exchangeCode("code", verifier);
    await started.promise;
    const clearing = session.clear();
    write.resolve();
    await clearing;
    expect(await pending).toBeNull();
    expect(s.data.has(key)).toBe(false);
  });
  test("failed secure persistence never publishes the unsaved session", async () => {
    const s = store();
    const storage = {
      ...s.storage,
      setItemAsync: () => Promise.reject(new Error("Keychain unavailable")),
    };
    const session = new WorkosSession(clientId, storage, transport);
    await expect(session.exchangeCode("code", verifier)).rejects.toThrow(
      "Keychain unavailable"
    );
    expect(session.getSnapshot().user).toBeNull();
    expect(await session.fetchAccessToken()).toBeNull();
  });
  test("timeouts preserve stored refresh credentials and allow retry", async () => {
    const initial = JSON.stringify({
      clientId,
      response: response("old", Date.now() - 1000),
    });
    const s = store(initial);
    let stall = true;
    const http: typeof fetch = (_url, init) =>
      stall
        ? new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("Timeout")),
              { once: true }
            );
          })
        : Promise.resolve(Response.json(response("rotated")));
    const session = new WorkosSession(clientId, s.storage, http, 1);
    await expect(session.fetchAccessToken()).rejects.toThrow("Timeout");
    expect(s.data.get(key)).toBe(initial);
    stall = false;
    expect(await session.fetchAccessToken()).not.toBeNull();
  });
  test.each([
    "issuer",
    "subject",
    "session",
    "expiry",
    "expired",
    "missing email verification",
    "oversized",
    "malformed",
  ])("rejects %s responses without storing tokens", async (failure: string) => {
    const s = store();
    const raw = response();
    const claims = JSON.parse(atob(raw.access_token.split(".")[1]));
    if (failure === "issuer") {
      claims.iss = "https://other.example";
    }
    if (failure === "subject") {
      claims.sub = "other-user";
    }
    if (failure === "session") {
      claims.sid = "oauth_access_token";
    }
    if (failure === "expiry") {
      claims.exp = "tomorrow";
    }
    if (failure === "expired") {
      claims.exp = 1;
    }
    if (failure === "missing email verification") {
      (raw.user as Partial<typeof raw.user>).email_verified = undefined;
    }
    raw.access_token = `header.${btoa(JSON.stringify(claims))}.signature`;
    const http: typeof fetch = () => {
      if (failure === "oversized") {
        return Promise.resolve(new Response("x".repeat(65_537)));
      }
      if (failure === "malformed") {
        return Promise.resolve(new Response("{"));
      }
      return Promise.resolve(Response.json(raw));
    };
    const session = new WorkosSession(clientId, s.storage, http);
    await expect(session.exchangeCode("code", verifier)).rejects.toThrow();
    expect(s.data.has(key)).toBe(false);
    expect(session.getSnapshot().user).toBeNull();
  });
});
