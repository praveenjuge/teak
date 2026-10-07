import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProvider } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import(
  "convex-helpers/react/cache/provider"
);
const { SecurityConnections } = await import("../SecurityConnections");
const { useSettingsController } = await import(
  "../../../hooks/useSettingsController"
);
const { createConvexTransport } = await import("./helpers/convexTransport");

let root: Root | undefined;
let container: HTMLDivElement;
let latest: ReturnType<typeof useSettingsController>;
const page = (rows: unknown[]) => ({
  page: rows,
  isDone: true,
  continueCursor: "",
});
const grants = [
  {
    consentId: "app_consent_A",
    clientId: "client_MAC",
    name: "Teak for Mac",
    connectedAt: 1,
    lastUsedAt: 2,
  },
  {
    consentId: "app_consent_B",
    clientId: "client_MAC",
    name: "Teak for Mac",
    connectedAt: 3,
    lastUsedAt: 4,
  },
];
let transport: ReturnType<typeof createConvexTransport>;

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container.remove();
  await transport.client.close();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function mount() {
  transport = createConvexTransport();
  transport.seed("auth:getCurrentUser", {
    _id: "A",
    email: "fixture@example.test",
  });
  transport.seed("auth:getAuthMode", { primary: "workos" });
  transport.seed("apiKeys:listUserApiKeys", []);
  transport.seed("dataExport:getLatestExport", null);
  transport.onCall(async (call) =>
    call.path === "securitySessions:listAuthkitSessions"
      ? page([
          {
            id: "session_A",
            name: "Current device",
            current: true,
            signedInAt: 1,
          },
        ])
      : null
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Fixture() {
    latest = useSettingsController({
      onDeleteAccount: async () => {},
      onOpenExternal: () => {},
      onSignOut: () => {},
    });
    return (
      <SecurityConnections
        betterAuthIdentityKey={latest.betterAuthIdentityKey}
        connectionIdentity={latest.connectionIdentity}
        onLoadMoreSessions={latest.loadMoreSessions}
        onRetrySessions={latest.retrySessions}
        onRevokeConnection={latest.handleRevokeOAuthConnection}
        onRevokeSession={latest.handleRevokeSession}
        sessions={latest.sessions}
        sessionsError={latest.sessionsError}
        sessionsHasMore={latest.sessionsHasMore}
        sessionsLoadingMore={latest.sessionsLoadingMore}
      />
    );
  }
  await act(() =>
    root?.render(
      <ConvexProvider client={transport.client}>
        <ConvexQueryCacheProvider>
          <Fixture />
        </ConvexQueryCacheProvider>
      </ConvexProvider>
    )
  );
}
function region(name: string) {
  const element = container.querySelector(`section[aria-label="${name}"]`);
  if (!element) {
    throw new Error(`Missing ${name} region`);
  }
  return element;
}
function buttons(name: string, parent = region("Connected apps")) {
  return [...parent.querySelectorAll("button")].filter(
    (button) =>
      (button.getAttribute("aria-label") ?? button.textContent)?.trim() === name
  );
}
async function click(name: string, parent?: Element) {
  const button = buttons(name, parent)[0];
  expect(button).toBeDefined();
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

// Failure modes: retained cached read errors, empty revoked pages, duplicate clients,
// failed disconnects, reactive removal, stale account callbacks and provider changes.
test("cached app retry retains devices and pages separate same-client grants", async () => {
  await mount();
  expect(region("Connected apps").textContent).toContain("Loading apps");
  await act(() =>
    transport.reply(
      "workosConsents:listConnections",
      new Error("Fixture outage")
    )
  );
  expect(region("Connected apps").textContent).toContain("Could not load apps");
  expect(region("Devices").textContent).toContain("Current device");
  const original = transport.requests.find(
    (entry) => entry.path === "workosConsents:listConnections"
  )!;
  await click("Try again");
  const retries = transport.requests.filter(
    (entry) => entry.path === "workosConsents:listConnections"
  );
  expect(retries).toHaveLength(2);
  expect(retries[1].args).not.toEqual(original.args);
  expect(original.callbacks.size).toBeGreaterThan(0);
  await act(() =>
    transport.reply(
      "workosConsents:listConnections",
      { page: [], isDone: false, continueCursor: "afterRevoked" },
      (args) => args.retryKey === retries[1].args.retryKey
    )
  );
  expect(region("Connected apps").textContent).not.toContain(
    "No apps are connected"
  );
  await click("Show more apps");
  await act(() =>
    transport.reply(
      "workosConsents:listConnections",
      page(grants),
      (args) =>
        (args.paginationOpts as { cursor: string | null }).cursor ===
        "afterRevoked"
    )
  );
  expect(buttons("Disconnect Teak for Mac")).toHaveLength(2);
  expect(region("Connected apps").textContent).not.toContain("Full access");
  expect(region("Connected apps").textContent).not.toContain("app_consent_");
  let failDisconnect!: (error: Error) => void;
  const rejectedDisconnect = new Promise<null>((_resolve, reject) => {
    failDisconnect = reject;
  });
  transport.onCall(() => rejectedDisconnect);
  await click("Disconnect Teak for Mac");
  expect(buttons("Disconnect Teak for Mac")[0].disabled).toBe(true);
  await act(async () => {
    failDisconnect(new Error("Mutation outage"));
    await rejectedDisconnect.catch(() => {});
  });
  expect(region("Connected apps").textContent).toContain("Could not update");
  expect(buttons("Disconnect Teak for Mac")).toHaveLength(2);
  transport.onCall(async (call) =>
    call.path === "securitySessions:listAuthkitSessions" ? page([]) : null
  );
  await click("Disconnect Teak for Mac");
  expect(transport.calls.at(-1)).toEqual({
    kind: "action",
    path: "workosConsents:disconnectConnection",
    args: { consentId: "app_consent_A" },
  });
  await act(() =>
    transport.reply(
      "workosConsents:listConnections",
      page([{ ...grants[1], clientId: "client_OTHER", name: "Other app" }]),
      (args) =>
        (args.paginationOpts as { cursor: string | null }).cursor ===
        "afterRevoked"
    )
  );
  expect(buttons("Disconnect Teak for Mac")).toHaveLength(0);
  expect(buttons("Disconnect Other app")).toHaveLength(1);
});

test("an account switch discards pending disconnect UI and rejects a stale callback", async () => {
  await mount();
  await act(() =>
    transport.reply("workosConsents:listConnections", page(grants))
  );
  const oldRevoke = latest.handleRevokeOAuthConnection;
  let reject!: (error: Error) => void;
  transport.onCall(async (call) =>
    call.path === "workosConsents:disconnectConnection"
      ? new Promise((_resolve, fail) => {
          reject = fail;
        })
      : page([])
  );
  await click("Disconnect Teak for Mac");
  await act(() => transport.reply("auth:getCurrentUser", { _id: "B" }));
  expect(region("Connected apps").textContent).not.toContain("Teak for Mac");
  expect(region("Connected apps").textContent).toContain("Loading apps");
  const request = transport.requests
    .filter((entry) => entry.path === "workosConsents:listConnections")
    .at(-1)!;
  await act(() =>
    transport.reply(
      "workosConsents:listConnections",
      page([{ ...grants[0], name: "B fixture app" }]),
      (args) => args.retryKey === request.args.retryKey
    )
  );
  await act(() => reject(new Error("Delayed outage")));
  expect(region("Connected apps").textContent).not.toContain(
    "Could not update"
  );
  expect(buttons("Disconnect B fixture app")[0].disabled).toBe(false);
  const before = transport.calls.length;
  await expect(
    oldRevoke({ provider: "workos", consentId: "app_consent_A" })
  ).rejects.toThrow("account changed");
  expect(transport.calls).toHaveLength(before);
  transport.onCall(async (call) =>
    call.path === "securitySessions:listAuthkitSessions" ? page([]) : null
  );
  await act(() => transport.reply("auth:getCurrentUser", { _id: "A" }));
  const returnedAccountCalls = transport.calls.length;
  await expect(
    oldRevoke({ provider: "workos", consentId: "app_consent_A" })
  ).rejects.toThrow("account changed");
  expect(transport.calls).toHaveLength(returnedAccountCalls);
});

test("provider changes keep BA app-wide dispatch and device cached retry independent", async () => {
  await mount();
  await act(() =>
    transport.reply("auth:getAuthMode", { primary: "betterauth" })
  );
  await act(() =>
    transport.reply("oauthTokens:listOAuthConnections", [
      { clientId: "client_BA", name: "BA fixture app", connectedAt: 1 },
    ])
  );
  await act(() =>
    transport.reply("securitySessions:listSessions", new Error("Device outage"))
  );
  expect(region("Devices").textContent).toContain("Could not load devices");
  expect(region("Connected apps").textContent).toContain("BA fixture app");
  await click("Try again", region("Devices"));
  const requests = transport.requests.filter(
    (entry) => entry.path === "securitySessions:listSessions"
  );
  expect(requests).toHaveLength(2);
  expect(requests[0].callbacks.size).toBeGreaterThan(0);
  await act(() =>
    transport.reply(
      "securitySessions:listSessions",
      page([
        { id: "session_BA", name: "BA device", signedInAt: 1, current: false },
      ]),
      (args) => args.retryKey === requests[1].args.retryKey
    )
  );
  expect(region("Devices").textContent).toContain("BA device");
  await click("Disconnect BA fixture app");
  expect(transport.calls.at(-1)).toEqual({
    kind: "action",
    path: "oauthTokens:revokeOAuthConnection",
    args: { clientId: "client_BA" },
  });
  await act(() => transport.reply("oauthTokens:listOAuthConnections", []));
  expect(region("Connected apps").textContent).toContain(
    "No apps are connected"
  );
});
