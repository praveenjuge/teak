import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { seedScenario } from "../helpers/seed";
import { describe, retry } from "../helpers/test";
import { expect, test } from "./fixtures";

interface SeededCard {
  _id: Id<"cards">;
  url?: string;
}

/**
 * A site whose pages are gone: `/status/<code>` answers with that status.
 * The E2E stack's link fetcher forwards `/teak-e2e-forward/<port>/…` hops
 * here (apps/core-worker/e2e/fakeLinkFetcher.ts), so the Core Worker's
 * real link check reaches it.
 */
const startGoneSite = async () => {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const status = Number(/^\/status\/(\d{3})/u.exec(request.url ?? "")?.[1]);
    response.writeHead(Number.isInteger(status) ? status : 200);
    response.end(request.method === "HEAD" ? undefined : "Not here");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    // A public address, so the Worker's checks pass; the fake fetcher never
    // connects to it.
    origin: `http://1.1.1.1/teak-e2e-forward/${port}`,
    requests,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe("Opening a link whose page is gone", () => {
  test("shows Teak's archived copy, sandboxed with no scripts", async ({
    browser,
    library,
    screen,
    webAccount,
  }) => {
    const site = await startGoneSite();
    try {
      await seedScenario(webAccount, "dead-links", { origin: site.origin });
      const cards = (await library.client.query(api.cards.getCards, {
        limit: 100,
      })) as SeededCard[];
      const goneUrl = `${site.origin}/status/404`;
      const gone = cards.find((card) => card.url === goneUrl);
      expect(gone).toBeDefined();
      const cardId = gone?._id as Id<"cards">;

      // The copy is written right after the cards; open again until it is.
      await retry(
        async () => {
          await gotoApp(browser, `/open/${cardId}`);
          await expect(
            screen.getByRole("heading", "Archived copy")
          ).toBeVisible({ timeout: 15_000 });
          await expect(browser.locator("iframe")).toBeVisible({
            timeout: 5000,
          });
        },
        { timeout: 60_000 }
      );

      expect(site.requests).toContain("HEAD /status/404");
      const sandbox = await browser.locator("iframe").getAttribute("sandbox");
      expect(sandbox).toBe("allow-popups allow-popups-to-escape-sandbox");
      expect(sandbox).not.toContain("allow-scripts");
      expect(sandbox).not.toContain("allow-same-origin");
      await expect(browser.locator("iframe")).toHaveAttribute(
        "referrerpolicy",
        "no-referrer"
      );
      await expect(
        screen.getByRole("link", "Try the original ↗")
      ).toHaveAttribute("href", goneUrl);
      await expect(screen.getByRole("link", "Open in Teak")).toHaveAttribute(
        "href",
        `/?card=${cardId}`
      );

      await gotoApp(browser, `/?card=${cardId}`);
      await expect(screen.getByText("Archived copy")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await site.stop();
    }
  });

  test("says a card that isn't one isn't available", async ({
    browser,
    screen,
    webAccount: _signedIn,
  }) => {
    await gotoApp(browser, "/open/not-a-card");
    await expect(screen.getByText("This card isn’t available.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(screen.getByRole("link", "Back to Teak")).toHaveAttribute(
      "href",
      "/"
    );
  });
});
