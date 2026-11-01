/// <reference types="bun" />
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "https://mail.example.com/inbox?id=7" });
}
// The other test files in this run expect Bun's own fetch and Request.
afterAll(() => GlobalRegistrator.unregister());

const { serializeRenderedPage } = await import("../../lib/pageSnapshot");

const PAGE = `
<head><title>Inbox</title><script>window.secret = 1;</script></head>
<body>
  <h1>Signed in as Ada</h1>
  <noscript>Turn on JavaScript</noscript>
  <template><p>Template</p></template>
  <form>
    <input id="search" value="old">
    <input id="password" type="password" value="from-server">
    <input id="token" type="hidden" value="csrf-123">
    <input id="otp" autocomplete="one-time-code">
    <input id="card" autocomplete="billing cc-number">
    <input id="remember" type="checkbox">
    <input id="plan-a" type="radio" name="plan" checked>
    <input id="plan-b" type="radio" name="plan">
    <textarea id="draft">old draft</textarea>
    <textarea id="new-password" autocomplete="new-password"></textarea>
    <select id="folder"><option value="a" selected>A</option><option value="b">B</option></select>
  </form>
</body>`;

const openingTag = (html: string, id: string) =>
  html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`, "u"))?.[0] ?? "";
const attribute = (html: string, id: string, name: string) => {
  const tag = openingTag(html, id);
  if (!tag) {
    return;
  }
  const match = tag.match(
    new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`, "u")
  );
  return match ? (match[1] ?? "") : null;
};
const textareaText = (html: string, id: string) =>
  html.match(
    new RegExp(`<textarea\\b[^>]*\\bid="${id}"[^>]*>([^<]*)</textarea>`, "u")
  )?.[1];

describe("serializeRenderedPage", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = PAGE;
  });

  test("keeps the page as shown, without scripts, noscript or templates", () => {
    const { html, url } = serializeRenderedPage();
    expect(url).toBe("https://mail.example.com/inbox?id=7");
    expect(html).toContain("<h1>Signed in as Ada</h1>");
    expect(html).not.toMatch(/<(?:script|noscript|template)\b/iu);
    expect(html).not.toContain("window.secret");
  });

  test("copies what was typed and chosen, and clears every secret field", () => {
    (document.getElementById("search") as HTMLInputElement).value = "teak";
    (document.getElementById("password") as HTMLInputElement).value = "hunter2";
    (document.getElementById("otp") as HTMLInputElement).value = "424242";
    (document.getElementById("card") as HTMLInputElement).value =
      "4242424242424242";
    (document.getElementById("remember") as HTMLInputElement).checked = true;
    (document.getElementById("plan-b") as HTMLInputElement).checked = true;
    (document.getElementById("draft") as HTMLTextAreaElement).value =
      "new draft";
    (document.getElementById("new-password") as HTMLTextAreaElement).value =
      "s3cret";
    (document.getElementById("folder") as HTMLSelectElement).value = "b";

    const { html } = serializeRenderedPage();

    expect(attribute(html, "search", "value")).toBe("teak");
    expect(attribute(html, "password", "value")).toBeNull();
    expect(attribute(html, "token", "value")).toBeNull();
    expect(attribute(html, "otp", "value")).toBeNull();
    expect(attribute(html, "card", "value")).toBeNull();
    expect(attribute(html, "remember", "checked")).toBe("");
    expect(attribute(html, "plan-a", "checked")).toBeNull();
    expect(attribute(html, "plan-b", "checked")).toBe("");
    expect(textareaText(html, "draft")).toBe("new draft");
    expect(textareaText(html, "new-password")).toBe("");
    expect(
      html
        .match(/<select\b[^>]*\bid="folder"[^>]*>(.*?)<\/select>/su)?.[1]
        ?.match(/<option\b[^>]*>/gu)
        ?.map((option) => /\sselected\b/u.test(option))
    ).toEqual([false, true]);
    for (const secret of [
      "hunter2",
      "from-server",
      "csrf-123",
      "424242",
      "4242424242424242",
      "s3cret",
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  test("names the page with a base element, keeping the page's own", () => {
    const bases = (html: string) =>
      Array.from(html.matchAll(/<base\b[^>]*\bhref="([^"]*)"/gu), (m) => m[1]);
    const first = serializeRenderedPage().html;
    expect(bases(first)).toEqual(["https://mail.example.com/inbox?id=7"]);
    expect(first.match(/<head>(.*?)<\/head>/su)?.[1]).toContain("<base ");

    document.head.insertAdjacentHTML("afterbegin", '<base href="/static/">');
    expect(bases(serializeRenderedPage().html)).toEqual([
      "https://mail.example.com/static/",
    ]);
  });
});
