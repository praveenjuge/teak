import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProvider } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import(
  "convex-helpers/react/cache/provider"
);
const { SecuritySection } = await import("../SecuritySection");
const { api } = await import("@teak/convex");
const { createConvexTransport } = await import("./helpers/convexTransport");

afterAll(async () => GlobalRegistrator.unregister());

// Failures: a cached device error hides working apps; remount reuses the failed
// subscription; retry never renders devices; recovered app disconnect is unusable.
test("device retry escapes a retained cached failure while apps remain usable", async () => {
  const transport = createConvexTransport();
  transport.seed("oauthTokens:listOAuthConnections", [
    { clientId: "fixture_app", name: "Fixture app", connectedAt: 1 },
  ]);
  transport.onCall(() => {
    transport.reply("oauthTokens:listOAuthConnections", []);
    return Promise.resolve(null);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    return (
      <SecuritySection
        apiKeys={{
          isLoading: false,
          keys: [],
          onCreateKey: async () => null,
          onRevokeKey: async () => {},
          onRotateKey: async () => null,
        }}
        betterAuthIdentityKey="owner"
        connectionIdentity={{
          provider: "betterauth",
          key: "owner",
          cacheKey: "fixture_apps",
        }}
        onLoadMoreSessions={() => {}}
        onRevokeConnection={async (target) =>
          transport.client.action(api.oauthTokens.revokeOAuthConnection, {
            clientId: target.provider === "betterauth" ? target.clientId : "",
          })
        }
        onRevokeSession={async () => {}}
        sessions={undefined}
        sessionsHasMore={false}
        sessionsLoadingMore={false}
      />
    );
  }
  const button = (name: string) => {
    const found = [...document.querySelectorAll("button")].find(
      (item) =>
        (item.getAttribute("aria-label") ?? item.textContent)?.trim() === name
    );
    if (!found) {
      throw new Error(`Missing ${name} button`);
    }
    return found;
  };
  try {
    await act(() =>
      root.render(
        <ConvexProvider client={transport.client}>
          <ConvexQueryCacheProvider>
            <Fixture />
          </ConvexQueryCacheProvider>
        </ConvexProvider>
      )
    );
    await act(() => button("Manage").click());
    await act(() =>
      transport.reply(
        "securitySessions:listSessions",
        new Error("Fixture device outage")
      )
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load devices"
    );
    expect(button("Disconnect Fixture app").disabled).toBe(false);
    const original = transport.requests.find(
      (row) => row.path === "securitySessions:listSessions"
    );
    expect(original).toBeDefined();
    await act(() => button("Try again").click());
    const queries = transport.requests.filter(
      (row) => row.path === "securitySessions:listSessions"
    );
    expect(queries).toHaveLength(2);
    expect(queries[1].args).not.toEqual(original!.args);
    expect(original!.callbacks.size).toBeGreaterThan(0);
    await act(() =>
      transport.reply(
        "securitySessions:listSessions",
        {
          page: [
            {
              id: "device_RECOVERED",
              name: "Recovered device",
              signedInAt: 1,
              current: false,
            },
          ],
          isDone: true,
          continueCursor: "",
        },
        (args) => args.retryKey === queries[1].args.retryKey
      )
    );
    expect(document.body.textContent).toContain("Recovered device");
    await act(async () => {
      button("Disconnect Fixture app").click();
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("Fixture app");
    expect(document.body.textContent).toContain("Recovered device");
  } finally {
    await act(() => root.unmount());
    container.remove();
    await transport.client.close();
  }
});
