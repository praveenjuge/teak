import { describe, expect, test } from "bun:test";
import {
  LIBRARY_VIEW_PATHS,
  LIBRARY_VIEWS,
  libraryViewForPath,
  libraryViewHref,
  quickCommandTarget,
} from "../libraryViews";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarOpenFromCookie,
  sidebarWidthFromCookie,
} from "../sidebarState";

describe("libraryViewForPath", () => {
  test("maps every view's path back to the view", () => {
    for (const view of LIBRARY_VIEWS) {
      expect(libraryViewForPath(LIBRARY_VIEW_PATHS[view])).toBe(view);
    }
  });

  test("ignores trailing slashes", () => {
    expect(libraryViewForPath("/archive/")).toBe("archive");
    expect(libraryViewForPath("///")).toBe("all");
    expect(libraryViewForPath(`/trash${"/".repeat(50_000)}`)).toBe("trash");
  });

  test.each(["/settings", "/favorites/extra", "/sign-in", null])(
    "is null outside the library: %p",
    (path) => {
      expect(libraryViewForPath(path)).toBeNull();
    }
  );
});

describe("libraryViewHref", () => {
  test("goes to the view's path", () => {
    expect(libraryViewHref("favorites")).toBe("/favorites");
  });

  test("carries a new-note request so the library focuses the composer", () => {
    expect(libraryViewHref("all", { focusComposer: true })).toBe("/?compose=1");
    expect(
      libraryViewForPath(
        new URL(`http://x${libraryViewHref("all", { focusComposer: true })}`)
          .pathname
      )
    ).toBe("all");
  });
});

describe("quickCommandTarget", () => {
  test("opens the command's view", () => {
    expect(quickCommandTarget("trash", "all")).toBe("trash");
    expect(quickCommandTarget("archive", "favorites")).toBe("archive");
  });

  test("goes back to Everything when that view is already open", () => {
    expect(quickCommandTarget("favorites", "favorites")).toBe("all");
  });
});

describe("sidebarOpenFromCookie", () => {
  test("stays open unless the cookie remembers it collapsed", () => {
    expect(sidebarOpenFromCookie(undefined)).toBe(true);
    expect(sidebarOpenFromCookie("true")).toBe(true);
    expect(sidebarOpenFromCookie("garbage")).toBe(true);
    expect(sidebarOpenFromCookie("false")).toBe(false);
  });
});

describe("sidebarWidthFromCookie", () => {
  test("uses the default width until one is remembered", () => {
    expect(sidebarWidthFromCookie(undefined)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(sidebarWidthFromCookie("wide")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  test("keeps a remembered width within the sidebar's bounds", () => {
    expect(sidebarWidthFromCookie("240")).toBe(240);
    expect(sidebarWidthFromCookie("80")).toBe(SIDEBAR_MIN_WIDTH);
    expect(sidebarWidthFromCookie("9000")).toBe(SIDEBAR_MAX_WIDTH);
  });
});
