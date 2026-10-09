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
// WorkOS AuthKit is the external session provider; everything below it is real.
const session = { user: { id: "user_A" }, sessionId: "session_A" };
mock.module("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => ({ ...session, loading: false }),
  useAccessToken: () => ({ error: undefined, refresh: async () => "token" }),
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

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container.remove();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const useSignedIn = () => ({
  isLoading: false,
  isAuthenticated: true,
  fetchAccessToken: async () => "token",
});

async function mount(useAuth = useSignedIn) {
  // The backend accepts the session token as soon as auth is set.
  transport.client.setAuth = (_fetchToken, onChange) => onChange?.(true);
  transport.client.clearAuth = () => undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
        <ConvexQueryCacheProvider>
          <WorkosAuthBoundary>
            <p>Vault open</p>
          </WorkosAuthBoundary>
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    )
  );
}

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
  await act(() => button("Try again").click());
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
  await act(() => button("Try again").click());
  expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fcards%3Fview%3Dgrid");
  replace.mockRestore();
});
