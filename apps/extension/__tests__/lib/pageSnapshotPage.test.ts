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

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

describe("serializeRenderedPage", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = PAGE;
  });

  test("keeps the page as shown, without scripts, noscript or templates", () => {
    const { html, url } = serializeRenderedPage();
    expect(url).toBe("https://mail.example.com/inbox?id=7");
    const page = parse(html);
    expect(page.querySelector("h1")?.textContent).toBe("Signed in as Ada");
    expect(page.querySelectorAll("script, noscript, template")).toHaveLength(0);
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
    const page = parse(html);
    const attribute = (id: string, name: string) =>
      page.getElementById(id)?.getAttribute(name);

    expect(attribute("search", "value")).toBe("teak");
    expect(attribute("password", "value")).toBeNull();
    expect(attribute("token", "value")).toBeNull();
    expect(attribute("otp", "value")).toBeNull();
    expect(attribute("card", "value")).toBeNull();
    expect(attribute("remember", "checked")).toBe("");
    expect(attribute("plan-a", "checked")).toBeNull();
    expect(attribute("plan-b", "checked")).toBe("");
    expect(page.getElementById("draft")?.textContent).toBe("new draft");
    expect(page.getElementById("new-password")?.textContent).toBe("");
    expect(
      Array.from(page.querySelectorAll("#folder option")).map((option) =>
        option.hasAttribute("selected")
      )
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
    const first = parse(serializeRenderedPage().html);
    expect(first.querySelector("head base")?.getAttribute("href")).toBe(
      "https://mail.example.com/inbox?id=7"
    );

    document.head.insertAdjacentHTML("afterbegin", '<base href="/static/">');
    const second = parse(serializeRenderedPage().html);
    expect(
      Array.from(second.querySelectorAll("base")).map((base) =>
        base.getAttribute("href")
      )
    ).toEqual(["https://mail.example.com/static/"]);
  });
});
