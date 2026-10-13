import { describe, expect, test } from "bun:test";
import {
  LIBRARY_VIEW_PATHS,
  LIBRARY_VIEWS,
  libraryViewForPath,
  quickCommandTarget,
} from "../libraryViews";
import { sidebarOpenFromCookie } from "../sidebarState";

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

describe("quickCommandTarget", () => {
  test("opens the command's view", () => {
    expect(quickCommandTarget("trash", "all")).toBe("trash");
    expect(quickCommandTarget("archive", "favorites")).toBe("archive");
  });

  test("goes back to All when that view is already open", () => {
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
