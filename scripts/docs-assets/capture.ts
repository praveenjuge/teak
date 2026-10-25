import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
} from "playwright-core";
import {
  browserPath,
  CACHE,
  type CaptureMeta,
  captureFile,
  VIEWPORT,
} from "./common.ts";
import { FOLDER, LINKS_NOTE, TABLE_NOTE } from "./seed-names.ts";
import { SHOTS, type WebShot } from "./shots.ts";

/**
 * Captures the docs' web app shots from the local stack (`bun run dev --detach`)
 * into `.cache/`, signed in as the stack's seeded account. Run
 * `bun scripts/store-assets/seed.ts --apply` first so the showcase cards lead
 * the library. Pass shot names to capture only those.
 */

const root = path.resolve(import.meta.dir, "../..");
const AUTH = path.join(CACHE, "auth.json");

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface Prepared {
  clip?: Box;
  markers?: Locator[];
}

const stack = JSON.parse(
  readFileSync(path.join(root, ".agents/.state/stack.json"), "utf8")
) as {
  account: { email: string; password: string };
  urls: { appOrigin: string };
};
const app = stack.urls.appOrigin;

/** Docs show a made-up person, never the stack's account or its devices. */
const REPLACEMENTS: [RegExp, string][] = [
  [
    new RegExp(stack.account.email.replace(/[.+]/g, "\\$&"), "g"),
    "alex@example.com",
  ],
  [/^Teak Developer$/, "Alex Rivera"],
  [/^Chrome on Linux$/, "Chrome on macOS"],
  [/^Unknown device$/, "Safari on iPhone"],
  [/^verify-teak$/, "Reading list script"],
  [/^teakapi_secret_live_[0-9a-z]+_/, "teakapi_secret_live_3f8a91c2_"],
];

const scrub = (page: Page) =>
  page.evaluate(
    (pairs) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
      );
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const [source, flags, to] of pairs) {
          const pattern = new RegExp(source, flags);
          const text = node.textContent ?? "";
          if (pattern.test(text.trim())) {
            const value = text.trim();
            node.textContent = text.replace(value, value.replace(pattern, to));
            seen += 1;
          }
        }
      }
      return seen;
    },
    REPLACEMENTS.map(([pattern, to]) => [pattern.source, pattern.flags, to])
  );

const signIn = async (context: BrowserContext) => {
  const page = await context.newPage();
  await page.goto(`${app}/`, { waitUntil: "domcontentloaded" });
  const email = page.getByRole("textbox", { name: "Email" });
  await email.or(page.getByRole("heading", { name: "Everything" })).waitFor();
  if (await email.isVisible()) {
    await email.fill(stack.account.email);
    await page
      .getByRole("button", { name: /^Continue/ })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "Password" })
      .fill(stack.account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page
      .getByRole("heading", { name: "Everything" })
      .waitFor({ timeout: 120_000 });
  }
  await context.storageState({ path: AUTH });
  await page.close();
};

const settle = async (page: Page) => {
  await page
    .getByRole("status", { name: "Loading cards" })
    .waitFor({ state: "detached", timeout: 90_000 })
    .catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((image) => image.getBoundingClientRect().top < innerHeight)
        .map((image) => image.decode().catch(() => undefined))
    );
  });
  await page.waitForTimeout(600);
};

const open = async (
  page: Page,
  route: string,
  heading: string
): Promise<undefined> => {
  await page.goto(`${app}${route}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .waitFor();
  await settle(page);
};

const pad = (box: Box, by: number): Box => ({
  x: Math.max(0, box.x - by),
  y: Math.max(0, box.y - by),
  width: box.width + by * 2,
  height: box.height + by * 2,
});

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`Not on screen: ${locator}`);
  }
  return box;
};

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const SEARCH_QUERY = "architecture";

/** A settings page's content column, from its heading to the bottom of `last`. */
const settingsColumn = async (page: Page, heading: string, last: Locator) => {
  const top = await boxOf(
    page.getByRole("heading", { name: heading, exact: true, level: 2 })
  );
  const bottom = await boxOf(last);
  const x = top.x - 32;
  const y = top.y - 32;
  return {
    x,
    y,
    width: VIEWPORT.width - x,
    height: bottom.y + bottom.height + 32 - y,
  };
};

const library = (page: Page) => open(page, "/", "Everything");

const search = async (page: Page): Promise<undefined> => {
  await open(page, "/", "Everything");
  const box = page.getByRole("combobox", { name: "Search everything" });
  await box.click();
  await box.pressSequentially(SEARCH_QUERY, { delay: 40 });
  await page.waitForTimeout(2500);
  // Close the suggestions so the results show.
  await page.keyboard.press("Escape");
  await settle(page);
};

const openCard = async (page: Page) => {
  await open(page, "/", "Everything");
  await page.getByRole("button", { name: "Image: Fallingwater.jpg" }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor();
  await settle(page);
  return dialog;
};

/** Searches the library, then opens the first card whose name matches. */
const findAndOpen = async (page: Page, query: string, card: RegExp) => {
  await open(page, "/", "Everything");
  const box = page.getByRole("combobox", { name: "Search everything" });
  await box.click();
  await box.pressSequentially(query, { delay: 30 });
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: card }).first().click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor();
  await settle(page);
  return dialog;
};

const PREPARE: Record<string, (page: Page) => Promise<Prepared | undefined>> = {
  library,
  search,
  "card-detail": async (page) => {
    const dialog = await openCard(page);
    return {
      clip: await boxOf(dialog),
      markers: [
        dialog.getByText("Tags", { exact: true }),
        dialog.getByText("Summary", { exact: true }),
        dialog.getByText("Colors", { exact: true }),
      ],
    };
  },
  "command-palette": async (page) => {
    await open(page, "/", "Everything");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await dialog.waitFor();
    await page.waitForTimeout(400);
  },
  "settings-account": (page) => open(page, "/settings", "Account"),
  import: async (page) => {
    await open(page, "/settings/data", "Import & export");
    await page.getByRole("combobox").first().click();
    await page.getByRole("listbox").waitFor();
    await page.waitForTimeout(300);
  },
  export: (page) => open(page, "/settings/data", "Import & export"),
  "connected-apps": (page) => open(page, "/settings/security", "Security"),
  "library-web": library,
  "search-web": async (page) => {
    await search(page);
    // Only the results: the library card beside it already shows the sidebar.
    const main = await boxOf(page.locator("main"));
    return { clip: { x: main.x, y: 0, width: main.width, height: 600 } };
  },
  "organize-web": async (page) => ({ clip: await boxOf(await openCard(page)) }),
  "import-web": async (page) => {
    await open(page, "/settings/data", "Import & export");
    return {
      clip: await settingsColumn(
        page,
        "Import & export",
        page.getByText(/One export per week/)
      ),
    };
  },
  "connected-apps-web": async (page) => {
    await open(page, "/settings/security", "Security");
    return {
      clip: await settingsColumn(
        page,
        "Security",
        page.getByRole("region", { name: "Connected apps" })
      ),
    };
  },
  "card-types": async (page) => {
    await library(page);
    // The grid alone, without the sidebar and header.
    const main = await boxOf(page.locator("main"));
    return {
      clip: {
        x: main.x,
        y: 64,
        width: main.width,
        height: VIEWPORT.height - 64,
      },
    };
  },
  reader: async (page) => {
    const dialog = await findAndOpen(
      page,
      "Fallingwater",
      /^Link: Fallingwater/
    );
    await dialog.getByRole("radio", { name: "Read" }).waitFor();
    // Wikipedia's infobox opens the article; start at its first paragraph.
    await dialog
      .locator("article p")
      .filter({ hasText: "is a house museum" })
      .first()
      .evaluate((paragraph) => {
        paragraph.scrollIntoView({ block: "start" });
        // Leave room for the sticky Preview · Read switch above it.
        let scroller = paragraph.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
          scroller = scroller.parentElement;
        }
        scroller?.scrollBy(0, -96);
      });
    await settle(page);
    return { clip: await boxOf(dialog) };
  },
  highlights: async (page) => {
    const dialog = await findAndOpen(
      page,
      "Fallingwater",
      /^Link: Fallingwater/
    );
    // Highlights are painted with the CSS Custom Highlight API, so find the
    // paragraph that holds the seeded quote instead of an element.
    const highlight = dialog
      .locator("article p")
      .filter({ hasText: "cantilevered, extending outward" })
      .first();
    await highlight.waitFor();
    await highlight.evaluate((mark) =>
      mark.scrollIntoView({ block: "center" })
    );
    await settle(page);
    return {
      clip: await boxOf(dialog),
      markers: [highlight, dialog.getByText(/^Highlights/).first()],
    };
  },
  "view-menu": async (page) => {
    await library(page);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Revisit" }).waitFor();
    await page.waitForTimeout(300);
  },
  folder: async (page) => {
    await library(page);
    await page.getByRole("link", { name: new RegExp(`^${FOLDER}`) }).click();
    await page.getByRole("heading", { name: FOLDER }).first().waitFor();
    await settle(page);
  },
  tags: (page) => open(page, "/tags", "Tags"),
  revisit: async (page) => {
    await library(page);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Revisit" }).click();
    const keep = page.getByRole("button", { name: /^Keep/ }).first();
    await keep.waitFor();
    // Revisit shuffles; keep cards (which changes nothing) until a photo shows.
    for (let tries = 0; tries < 15; tries += 1) {
      await settle(page);
      if (await page.getByRole("dialog").last().locator("img").count()) {
        break;
      }
      await keep.click();
    }
  },
  "note-links": async (page) => ({
    clip: await boxOf(
      await findAndOpen(page, LINKS_NOTE, new RegExp(`^Text: ${LINKS_NOTE}`))
    ),
  }),
  "note-table": async (page) => {
    const dialog = await findAndOpen(
      page,
      TABLE_NOTE,
      new RegExp(`^Text: ${TABLE_NOTE}`)
    );
    await dialog.locator("table").first().waitFor();
    return { clip: await boxOf(dialog) };
  },
  "link-details": async (page) => {
    const dialog = await findAndOpen(
      page,
      "Fallingwater",
      /^Link: Fallingwater/
    );
    await dialog.getByRole("radio", { name: "Preview" }).click();
    await dialog.getByRole("button", { name: "More details" }).click();
    await settle(page);
    return {
      clip: await boxOf(dialog),
      markers: [
        dialog.getByText("About", { exact: true }),
        dialog.getByText("Archived copy", { exact: true }),
      ],
    };
  },
  "api-keys": (page) => open(page, "/settings/integrations", "Integrations"),
  language: async (page) => {
    await open(page, "/settings/appearance", "Appearance");
    const heading = page.getByText("Language", { exact: true });
    await page.getByRole("combobox").last().click();
    const list = page.getByRole("listbox");
    await list.waitFor();
    await page.waitForTimeout(300);
    const top = await boxOf(heading);
    return { clip: pad(union(top, await boxOf(list)), 40) };
  },
};

const capture = async (context: BrowserContext, shot: WebShot) => {
  const prepare = PREPARE[shot.name];
  if (!prepare) {
    throw new Error(`No capture steps for ${shot.name}`);
  }
  const page = await context.newPage();
  const prepared = (await prepare(page)) ?? {};
  await scrub(page);
  const clip = prepared.clip;
  const meta: CaptureMeta = {};
  if (prepared.markers?.length) {
    meta.markers = [];
    for (const [index, marker] of prepared.markers.entries()) {
      const box = await boxOf(marker);
      meta.markers.push({
        n: index + 1,
        x: box.x - (clip?.x ?? 0),
        y: box.y + box.height / 2 - (clip?.y ?? 0),
      });
    }
  }
  await page.screenshot({
    path: captureFile(shot.name),
    clip,
    animations: "disabled",
  });
  writeFileSync(
    path.join(CACHE, `${shot.name}.json`),
    JSON.stringify(meta, null, 2)
  );
  await page.close();
  console.log(`captured ${shot.name}`);
};

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  const shots = SHOTS.filter(
    (shot): shot is WebShot =>
      shot.kind === "web" && (!wanted.length || wanted.includes(shot.name))
  );
  mkdirSync(CACHE, { recursive: true });
  const browser = await chromium.launch({
    executablePath: browserPath(),
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    storageState: existsSync(AUTH) ? AUTH : undefined,
  });
  await context.addInitScript(() => {
    const style = document.createElement("style");
    // The Next.js dev indicator and scrollbars never belong in a screenshot.
    style.textContent =
      "nextjs-portal{display:none!important} *{scrollbar-width:none!important}";
    document.addEventListener("DOMContentLoaded", () =>
      document.head.append(style)
    );
  });
  await signIn(context);
  for (const shot of shots) {
    await capture(context, shot);
  }
  await browser.close();
}
