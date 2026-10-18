import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/cards?view=grid" });

mock.module("server-only", () => ({}));
const session = { user: { id: "user_A" }, sessionId: "session_A" };
const accessToken: { error?: Error; refresh?: () => Promise<string> } = {};
mock.module("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({ ...session, loading: false }),
  useAccessToken: () => ({
    error: accessToken.error,
    refresh: () => accessToken.refresh?.() ?? Promise.resolve("token"),
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import(
  "@teak/ui/convex-query-cache"
);
const { createConvexTransport } = await import(
  "../../../../packages/ui/src/components/settings/__tests__/helpers/convexTransport"
);
const { WorkosAuthBoundary } = await import("../components/WorkosAuthBoundary");

const profile = { _id: "teak_A", email: "a@example.test", emailVerified: true };
let root: Root | undefined;
let container: HTMLDivElement;
let transport: ReturnType<typeof createConvexTransport>;
let answerAuth: ((isAuthenticated: boolean) => void) | undefined;

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container.remove();
  accessToken.error = undefined;
  accessToken.refresh = undefined;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const fetchAccessToken = async () => "token";
const useSignedIn = () => ({
  isLoading: false,
  isAuthenticated: true,
  fetchAccessToken,
});

async function mount(useAuth = useSignedIn, { backendAnswers = true } = {}) {
  transport.client.setAuth = (_fetchToken, onChange) => {
    answerAuth = onChange;
    if (backendAnswers) {
      onChange?.(true);
    }
  };
  transport.client.clearAuth = () => undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render(useAuth);
}

const render = (useAuth = useSignedIn) =>
  act(() =>
    root?.render(
      <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
        <ConvexQueryCacheProvider>
          <WorkosAuthBoundary loading={<p>App frame</p>}>
            <p>Vault open</p>
          </WorkosAuthBoundary>
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    )
  );

const ensureCalls = () =>
  transport.calls.filter((call) => call.path === "workosBootstrap:ensureUser");
const text = () => container.textContent ?? "";
const button = (name: string) => {
  const match = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );
  if (!match) {
    throw new Error(`Missing ${name} button`);
  }
  return match;
};

test("opens the vault for a linked owner without running ensureUser", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  await mount();

  expect(text()).toContain("Vault open");
  expect(ensureCalls()).toHaveLength(0);
});

test("shows the app frame, not the vault, until the backend accepts the session", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  await mount(useSignedIn, { backendAnswers: false });
  expect(text()).toBe("App frame");

  await act(() => answerAuth?.(true));
  expect(text()).toBe("Vault open");
});

test("bootstraps a new owner once, then opens the vault", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", null);
  transport.onCall((call) => {
    if (call.path !== "workosBootstrap:ensureUser") {
      return Promise.resolve(null);
    }
    // Convex resolves a mutation only after queries reflect its writes.
    transport.reply("auth:getAuthUser", profile);
    return Promise.resolve({ status: "ok", teakUserId: profile._id });
  });
  await mount();

  expect(text()).toContain("Vault open");
  expect(ensureCalls()).toHaveLength(1);
});

test.each([
  ["verify_email", "Verify your email to open Teak."],
  ["frozen", "Signups are paused. Your account hasn't been created."],
  [
    "quarantined",
    "Your account isn't ready yet. Try again or contact support.",
  ],
] as const)(
  "keeps the vault closed when ensureUser reports %s",
  async (status, message) => {
    transport = createConvexTransport();
    transport.seed("auth:getAuthUser", null);
    transport.onCall(async () =>
      status === "quarantined"
        ? { status, reason: "profile_pending" }
        : { status }
    );
    await mount();

    expect(text()).toContain(message);
    expect(text()).not.toContain("Vault open");
    expect(ensureCalls()).toHaveLength(1);

    await act(() => button("Try again").click());
    expect(ensureCalls()).toHaveLength(2);
  }
);

test("runs ensureUser again from Try again after it fails", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", null);
  let attempts = 0;
  transport.onCall((call) => {
    if (call.path !== "workosBootstrap:ensureUser") {
      return Promise.resolve(null);
    }
    attempts += 1;
    if (attempts === 1) {
      return Promise.reject(new Error("Backend unavailable"));
    }
    transport.reply("auth:getAuthUser", profile);
    return Promise.resolve({ status: "ok", teakUserId: profile._id });
  });
  await mount();
  await act(async () => undefined);
  expect(text()).toContain("We couldn't check your session.");

  await act(async () => button("Try again").click());

  expect(ensureCalls()).toHaveLength(2);
  expect(text()).toContain("Vault open");
});

test("asks to sign in again when the open vault's owner disappears", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  await mount();
  expect(text()).toContain("Vault open");

  await act(() => transport.reply("auth:getAuthUser", null));

  expect(text()).toContain("Your session changed. Please sign in again.");
  expect(text()).not.toContain("Vault open");
  expect(ensureCalls()).toHaveLength(0);
  const replace = spyOn(window.location, "replace").mockImplementation(
    () => undefined
  );
  await act(() => button("Sign in").click());
  expect(replace).toHaveBeenCalledWith("/sign-in");
  replace.mockRestore();
});

test("sends a vault whose owner changed to sign-in", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  await mount();

  await act(() =>
    transport.reply("auth:getAuthUser", { ...profile, _id: "teak_B" })
  );

  expect(text()).toContain("Your session changed. Please sign in again.");
  expect(text()).not.toContain("Vault open");
});

test("sends a session Convex rejects to sign-in with its current page", async () => {
  transport = createConvexTransport();
  await mount(() => ({ ...useSignedIn(), isAuthenticated: false }));

  expect(text()).toContain("Please sign in again.");
  expect(transport.requests).toHaveLength(0);
  const replace = spyOn(window.location, "replace").mockImplementation(
    () => undefined
  );
  await act(() => button("Sign in").click());
  expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fcards%3Fview%3Dgrid");
  replace.mockRestore();
});

test("keeps the vault open when a token refresh fails on a dropped connection", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  await mount();
  expect(text()).toContain("Vault open");

  accessToken.error = new TypeError("Failed to fetch");
  await render();

  expect(text()).toContain("Vault open");
  expect(text()).not.toContain("We couldn't check your session.");
});

test("offers a retry when no token arrives before the vault opens", async () => {
  transport = createConvexTransport();
  accessToken.error = new TypeError("Failed to fetch");
  await mount(useSignedIn, { backendAnswers: false });

  expect(text()).toContain("We couldn't check your session. Please try again.");
  expect(text()).not.toContain("Vault open");
});

test("opens the vault once a token arrives after a failed retry", async () => {
  transport = createConvexTransport();
  transport.seed("auth:getAuthUser", profile);
  accessToken.error = new TypeError("Failed to fetch");
  accessToken.refresh = () => Promise.reject(new TypeError("Failed to fetch"));
  await mount(useSignedIn, { backendAnswers: false });
  await act(() => button("Try again").click());
  expect(text()).toContain("We couldn't check your session.");

  accessToken.error = undefined;
  await act(() => answerAuth?.(true));

  expect(text()).toContain("Vault open");
});
