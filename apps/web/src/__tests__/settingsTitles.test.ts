import { afterAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { loadMessages } from "@teak/i18n";

GlobalRegistrator.register({ url: "http://localhost:3000/settings" });

// The routes' query prewarming needs a Convex deployment; titles don't.
mock.module("@/lib/convexClient", () => ({
  convex: {},
  prewarmPageLoader: () => undefined,
  prewarmRouteQueries: () => undefined,
}));

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

type Head = (context: { matches: { loaderData?: unknown }[] }) => {
  meta: { title?: string }[];
};

// Each Settings route's tab title, as its `head` writes it for a session.
const routeTitle = async (file: string, loaderData?: unknown) => {
  const { Route } = await import(`../routes/_app/settings/${file}`);
  const head = (Route.options as { head: Head }).head;
  return head({ matches: [{ loaderData }] }).meta[0]?.title;
};

describe("Settings tab titles", () => {
  test("name each page under Settings", async () => {
    expect(await routeTitle("index")).toBe("Settings · Teak");
    expect(await routeTitle("appearance")).toBe("Appearance · Settings · Teak");
    expect(await routeTitle("integrations")).toBe(
      "Integrations · Settings · Teak"
    );
    expect(await routeTitle("security")).toBe("Security · Settings · Teak");
    expect(await routeTitle("data")).toBe("Import & export · Settings · Teak");
    expect(await routeTitle("plan")).toBe("Plan · Settings · Teak");
  });

  test("follow the language the signed-in layout loaded", async () => {
    const session = { locale: "de", messages: await loadMessages("de") };
    expect(await routeTitle("index", session)).toBe("Einstellungen · Teak");
    expect(await routeTitle("security", session)).toBe(
      "Sicherheit · Einstellungen · Teak"
    );
  });
});
