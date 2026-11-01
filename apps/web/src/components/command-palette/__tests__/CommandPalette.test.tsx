import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FolderSummary } from "../../../lib/folders";
import { Command, CommandList } from "../../ui/command";
import {
  CommandPaletteResults,
  filterPaletteItem,
  type PaletteCardsState,
} from "../CommandPalette";

const folder = (
  overrides: Partial<FolderSummary> & Pick<FolderSummary, "_id" | "name">
): FolderSummary =>
  ({
    activeCardCount: 0,
    kind: "manual",
    ...overrides,
  }) as FolderSummary;

const render = ({
  cards = { status: "idle" },
  folders = [],
  pathname = "/",
  query = "",
}: {
  cards?: PaletteCardsState;
  folders?: FolderSummary[];
  pathname?: string;
  query?: string;
}) =>
  renderToStaticMarkup(
    <Command filter={filterPaletteItem}>
      <CommandList>
        <CommandPaletteResults
          cards={cards}
          folders={folders}
          onSelect={() => undefined}
          pathname={pathname}
          query={query}
        />
      </CommandList>
    </Command>
  );

const headings = (html: string) =>
  [...html.matchAll(/cmdk-group-heading=""[^>]*>([^<]+)</g)].map(
    (match) => match[1]
  );

describe("CommandPaletteResults", () => {
  test("lists the views, Settings pages and actions, and no folder group without folders", () => {
    const html = render({});
    expect(headings(html)).toEqual(["Navigate", "Actions", "Settings"]);
    for (const label of [
      "Everything",
      "Favorites",
      "Archive",
      "Trash",
      "Tags",
      "Settings",
      "New note",
      "Upload files",
      "Import",
      "Export",
      "Toggle theme",
      "Shuffle",
      "Keyboard shortcuts",
      "Sign out",
      "Settings: Plan",
      "Settings: Appearance",
      "Settings: Integrations",
      "Settings: Security",
      "Settings: Import &amp; export",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  test("hides keyboard hints on touch screens", () => {
    const html = render({});
    const hints = html.match(/<span aria-hidden="true" class="[^"]*"/g) ?? [];
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints.filter((span) => span.includes("ml-auto"))) {
      expect(hint).toContain("pointer-coarse:hidden");
    }
    expect(html).toMatch(/pointer-coarse:hidden[^>]*>.*then/);
  });

  test("offers Empty Trash only in Trash", () => {
    expect(render({})).not.toContain(">Empty Trash<");
    expect(render({ pathname: "/trash" })).toContain(">Empty Trash<");
  });

  test("lists folders and marks smart folders, with the full name as a tooltip", () => {
    const long = `${"Very long folder ".repeat(17)}end`;
    const html = render({
      folders: [
        folder({ _id: "f1", name: "Reading" }),
        folder({ _id: "f2", kind: "smart", name: "Moodboard" }),
        folder({ _id: "f3", name: long }),
      ],
    });
    expect(headings(html)).toEqual([
      "Navigate",
      "Actions",
      "Settings",
      "Folders",
    ]);
    expect(html).toContain(">Reading<");
    expect(html).toContain('aria-label="Smart folder"');
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain('dir="auto"');
  });

  test("leaves the Cards group out under two characters", () => {
    expect(headings(render({ query: "a" }))).not.toContain("Cards");
  });

  test("shows skeleton rows while cards load, and no empty message", () => {
    const html = render({ cards: { status: "loading" }, query: "bauhaus" });
    expect(headings(html)).toContain("Cards");
    expect(html).toContain('aria-label="Searching cards"');
    expect(html).not.toContain("No results");
  });

  test("shows an error row in the Cards group only", () => {
    const html = render({ cards: { status: "error" }, query: "bauhaus" });
    expect(html).toContain("Couldn’t search cards");
    expect(html).toContain(">Everything<");
  });

  test("lists matching cards with their site, then Search all", () => {
    const html = render({
      cards: {
        status: "ready",
        cards: [
          {
            _id: "c1",
            type: "link",
            url: "https://www.example.com/bauhaus",
            metadata: {
              linkPreview: { status: "success", title: "Bauhaus school" },
            },
          },
          { _id: "c2", type: "text", content: "Bauhaus notes" },
        ],
      },
      query: "bauhaus",
    });
    expect(html).toContain(">Bauhaus school<");
    expect(html).toContain(">example.com<");
    expect(html).toContain(">Bauhaus notes<");
    expect(html).toContain("Search all for “bauhaus”");
  });

  test("still offers to search everywhere when no card matches", () => {
    const html = render({
      cards: { status: "ready", cards: [] },
      query: "kestral",
    });
    expect(headings(html)).toContain("Cards");
    expect(html).toContain("Search all for “kestral”");
    expect(html).not.toContain('value="card:');
  });

  test("names the results list in the app's language, not cmdk's", () => {
    const html = renderToStaticMarkup(
      <Command>
        <CommandList label="Ergebnisse" />
      </Command>
    );
    expect(html).toContain('aria-label="Ergebnisse"');
    expect(html).not.toContain("Suggestions");
  });
});

describe("filterPaletteItem", () => {
  test("matches a row by its label, never by its id", () => {
    expect(
      filterPaletteItem("folder:k57abc", "k57", ["Reading", "folder"])
    ).toBe(0);
    expect(
      filterPaletteItem("folder:k57abc", "read", ["Reading", "folder"])
    ).toBeGreaterThan(0);
  });

  test("keeps the server's cards, below an exact local match", () => {
    const card = filterPaletteItem("card:c1", "reading", []);
    const exact = filterPaletteItem("folder:f1", "reading", ["Reading"]);
    expect(card).toBeGreaterThan(0);
    expect(exact).toBeGreaterThan(card);
    expect(filterPaletteItem("search-all", "reading", [])).toBeLessThan(card);
  });
});
