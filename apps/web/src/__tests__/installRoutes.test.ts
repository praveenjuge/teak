import { describe, expect, test } from "bun:test";
import manifest from "../app/manifest";
import { POST as share } from "../app/share/route";
import { GET as worker } from "../app/sw.js/route";

describe("the installed web app", () => {
  test("its manifest opens the library standalone and takes shares", () => {
    const app = manifest();
    expect(app).toMatchObject({
      name: "Teak",
      start_url: "/",
      scope: "/",
      display: "standalone",
      share_target: {
        action: "/share",
        method: "POST",
        enctype: "multipart/form-data",
      },
    });
    expect(app.icons?.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "192x192 maskable",
      "512x512 maskable",
    ]);
  });

  test("/sw.js is a worker allowed to control the whole app", async () => {
    const response = worker();
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    expect(await response.text()).toContain('addEventListener("fetch"');
  });
});

describe("/share without the service worker", () => {
  const post = (form: FormData) =>
    share(
      new Request("https://teak.test/share", { method: "POST", body: form })
    );

  test("sends the text on to the composer", async () => {
    const form = new FormData();
    form.set("title", "Example");
    form.set("url", "https://example.com/a");
    const response = await post(form);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://teak.test/?compose=1&title=Example&url=https%3A%2F%2Fexample.com%2Fa"
    );
  });

  test("says shared files were lost, since they can't follow a redirect", async () => {
    const form = new FormData();
    form.set("text", "hi");
    form.append("files", new File(["png"], "a.png", { type: "image/png" }));
    const response = await post(form);
    expect(response.headers.get("location")).toBe(
      "https://teak.test/?compose=1&text=hi&share=missing"
    );
  });
});
