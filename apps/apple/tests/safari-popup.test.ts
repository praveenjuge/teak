import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Runs the real Safari popup against fake DOM, tab and native-message
// boundaries. Native feedback must always render as plain text.
const source = readFileSync(
  new URL("../SafariExtension/Resources/popup.js", import.meta.url),
  "utf8"
);

type Reply = Record<string, unknown>;

async function popup(
  replies: Record<string, Reply>,
  options: { tabUrl?: string; action?: string } = {}
) {
  const title = { textContent: "" };
  const message = {
    textContent: "",
    set innerHTML(_value: string) {
      throw new Error("Native feedback must not be interpreted as HTML");
    },
  };
  const body = { dataset: { state: "" } };
  const sent: Reply[] = [];
  const opened: string[] = [];
  const context = createContext({
    URL,
    document: {
      body,
      getElementById: (id: string) => {
        if (id === "title") {
          return title;
        }
        if (id === "message") {
          return message;
        }
        return { addEventListener() {} };
      },
    },
    browser: {
      runtime: {
        sendNativeMessage: (host: string, payload: Reply) => {
          expect(host).toBe("com.praveenjuge.teak");
          sent.push(payload);
          return Promise.resolve(replies[payload.type as string] ?? {});
        },
      },
      tabs: {
        query: () => Promise.resolve([{ url: options.tabUrl ?? "https://example.com/post" }]),
        create: ({ url }: { url: string }) => {
          opened.push(url);
          return Promise.resolve({});
        },
      },
    },
  });
  runInContext(source, context);
  await runInContext("run()", context);
  if (options.action) {
    await runInContext(`${options.action}()`, context);
  }
  return { title, message, body, sent, opened };
}

test("saves the current page and confirms it", async () => {
  const result = await popup({
    getAuthState: { authenticated: true },
    saveCurrentPage: { status: "saved", cardId: "c1" },
  });
  expect(result.body.dataset.state).toBe("saved");
  expect(result.title.textContent).toBe("Saved to Teak");
  expect(result.sent).toContainEqual({
    version: 1,
    type: "saveCurrentPage",
    url: "https://example.com/post",
  });
});

test("says when the page is already saved", async () => {
  const result = await popup({
    getAuthState: { authenticated: true },
    saveCurrentPage: { status: "duplicate", cardId: "c1" },
  });
  expect(result.title.textContent).toBe("Already saved");
});

test("refuses pages that aren't regular websites", async () => {
  const result = await popup(
    { getAuthState: { authenticated: true } },
    { tabUrl: "about:blank" }
  );
  expect(result.body.dataset.state).toBe("invalid");
  expect(result.sent.some((payload) => payload.type === "saveCurrentPage")).toBe(false);
});

test("asks a signed-out person to sign in, and opens Teak on iPhone", async () => {
  const result = await popup(
    {
      getAuthState: { authenticated: false },
      startSignIn: { status: "open-url", url: "teak://connect" },
    },
    { action: "startSignIn" }
  );
  expect(result.opened).toEqual(["teak://connect"]);
  expect(result.title.textContent).toBe("Finish sign in");
});

test("shows native errors as plain text", async () => {
  const notice = "Couldn't save. <img src=x onerror=alert(1)>";
  const result = await popup({
    getAuthState: { authenticated: true },
    saveCurrentPage: { status: "error", message: notice },
  });
  expect(result.title.textContent).toBe("Save failed");
  expect(result.message.textContent).toBe(notice);
});

test("signs out", async () => {
  const result = await popup(
    {
      getAuthState: { authenticated: true },
      saveCurrentPage: { status: "saved" },
      signOut: { status: "signed-out" },
    },
    { action: "signOut" }
  );
  expect(result.title.textContent).toBe("Signed out");
  expect(result.message.textContent).toBe("Sign in to save pages.");
});
