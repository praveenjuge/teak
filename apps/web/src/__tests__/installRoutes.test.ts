import { describe, expect, test } from "bun:test";
import manifest from "../app/manifest";
import { POST as share } from "../app/share/route";
import { GET as worker } from "../app/sw.js/route";

describe("the installed web app", () => {
  test("a share sent the way its manifest describes reaches the composer", async () => {
    const target = manifest().share_target;
    if (!target?.params) {
      throw new Error("the manifest takes no shares");
    }
    const { files, ...textParams } = target.params as Record<
      string,
      unknown
    > & {
      files: { name: string }[];
    };
    const form = new FormData();
    for (const name of Object.values(textParams) as string[]) {
      form.set(name, `shared ${name}`);
    }
    form.append(
      files[0]?.name ?? "",
      new File(["png"], "a.png", { type: "image/png" })
    );
    const response = await share(
      new Request(new URL(target.action, "https://teak.test"), {
        method: target.method,
        body: form,
      })
    );
    const location = new URL(response.headers.get("location") ?? "");
    for (const name of Object.values(textParams) as string[]) {
      expect(location.searchParams.get(name)).toBe(`shared ${name}`);
    }
    expect(location.searchParams.get("share")).toBe("missing");
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
