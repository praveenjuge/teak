import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRaycastApiMock } from "./raycastApiMock";

const Action = ({ title }: { title: string }) =>
  createElement("button", null, title);
Object.assign(Action, { OpenInBrowser: Action, Open: Action });
mock.module("@raycast/api", () => ({
  ...createRaycastApiMock(false),
  Action,
  openExtensionPreferences: () => {},
  showToast: () => Promise.resolve(),
  Toast: { Style: { Failure: "failure" } },
  ActionPanel: ({ children }: { children: ReactNode }) =>
    createElement("nav", null, children),
  Detail: ({ markdown, actions }: { markdown: string; actions: ReactNode }) =>
    createElement("main", null, markdown, actions),
  Icon: { Globe: "globe", Key: "key" },
}));
const { MissingApiKeyDetail } =
  await import("../components/MissingApiKeyDetail");

// A discovery outage must show recovery, preserve credentials, and avoid prompting sign-in.
test("discovery outage presents connection recovery instead of a signed-out prompt", () => {
  const html = renderToStaticMarkup(
    createElement(MissingApiKeyDetail, {
      error: "Unable to reach Teak. Check your connection and retry.",
      onSignedIn: () => {},
    }),
  );
  expect(html).toContain("Connection unavailable");
  expect(html).toContain("Check your connection and retry");
  expect(html).toContain("Retry Connection");
  expect(html).not.toContain("Sign in with Browser");
  expect(html).not.toContain("Set API Key");
});
