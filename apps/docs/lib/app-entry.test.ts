import { describe, expect, test } from "bun:test";
import { appEntryScript, SIGN_IN_ORIGINS, WEB_APP_URL } from "./app-entry";

type Handler = (event: { target: unknown }) => void;

// The smallest document the script touches, so a test can read what it did.
function runScript(cookie: string) {
  const handlers = new Map<string, Handler[]>();
  const preconnects: string[] = [];
  const links = [{ href: `${WEB_APP_URL}/sign-up` }];
  const documentStub = {
    cookie,
    documentElement: { dataset: {} as Record<string, string> },
    head: {
      append: (link: { rel: string; href: string }) => {
        if (link.rel === "preconnect") {
          preconnects.push(link.href);
        }
      },
    },
    createElement: () => ({ rel: "", href: "" }),
    querySelectorAll: () => links,
    addEventListener: (type: string, handler: Handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
  };
  new Function("document", appEntryScript())(documentStub);
  const fire = (type: string, target: unknown) => {
    for (const handler of handlers.get(type) ?? []) {
      handler({ target });
    }
  };
  const appEntry = { closest: (selector: string) => selector };
  const other = { closest: () => null };
  return { documentStub, fire, links, preconnects, appEntry, other };
}

describe("teakvault.com app entry", () => {
  test("shows a signed-in visitor Open Teak, linking into the app", () => {
    const page = runScript("theme=dark; teak_session_hint=1");
    expect(page.documentStub.documentElement.dataset).toEqual({
      signedIn: "",
    });
    page.fire("DOMContentLoaded", null);
    expect(page.links).toEqual([{ href: `${WEB_APP_URL}/` }]);
  });

  test.each(["", "teak_session_hint=", "xteak_session_hint=1"])(
    "leaves sign-in links alone for cookie %p",
    (cookie) => {
      const page = runScript(cookie);
      expect(page.documentStub.documentElement.dataset).toEqual({});
      page.fire("DOMContentLoaded", null);
      expect(page.links).toEqual([{ href: `${WEB_APP_URL}/sign-up` }]);
    }
  );

  test("warms every sign-in host once a pointer reaches a sign-up link", () => {
    const page = runScript("");
    page.fire("pointerover", page.other);
    expect(page.preconnects).toEqual([]);
    page.fire("pointerover", page.appEntry);
    page.fire("focusin", page.appEntry);
    expect(page.preconnects).toEqual(
      SIGN_IN_ORIGINS.map((origin) => new URL(origin).origin)
    );
  });

  test("warms only the app for a signed-in visitor", () => {
    const page = runScript("teak_session_hint=1");
    page.fire("focusin", page.appEntry);
    expect(page.preconnects).toEqual([WEB_APP_URL]);
  });
});
