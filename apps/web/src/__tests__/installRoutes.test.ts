import { describe, expect, test } from "bun:test";
import { installFiles } from "../lib/installFiles";
import {
  handleShareAction,
  handleShareVisit,
} from "../lib/share/shareActionRoute";
import { webManifest } from "../lib/webManifest";

const installFile = (path: string) => {
  const file = installFiles.find((entry) => entry.path === path);
  if (!file) {
    throw new Error(`${path} is not an install file`);
  }
  return file;
};

// The headers public/_headers gives one exact path.
const staticHeaders = async (path: string) => {
  const rules = await Bun.file(
    new URL("../../public/_headers", import.meta.url)
  ).text();
  const block = rules
    .split(/\n\s*\n/)
    .find((chunk) =>
      chunk
        .split("\n")
        .some((line) => line.trim() === path && !line.startsWith(" "))
    );
  return new Headers(
    (block ?? "")
      .split("\n")
      .filter((line) => line.startsWith("  "))
      .map((line) => {
        const [name, ...value] = line.trim().split(":");
        return [name, value.join(":").trim()] as [string, string];
      })
  );
};

describe("the installed web app", () => {
  test("a share sent the way its manifest describes reaches the composer", async () => {
    const target = webManifest().share_target;
    const { files, ...textParams } = target.params;
    const form = new FormData();
    for (const name of Object.values(textParams)) {
      form.set(name, `shared ${name}`);
    }
    form.append(
      files[0].name,
      new File(["png"], "a.png", { type: "image/png" })
    );
    const response = await handleShareAction(
      new Request(new URL(target.action, "https://teak.test"), {
        method: target.method,
        body: form,
      })
    );
    const location = new URL(response.headers.get("location") ?? "");
    for (const name of Object.values(textParams)) {
      expect(location.searchParams.get(name)).toBe(`shared ${name}`);
    }
    expect(location.searchParams.get("share")).toBe("missing");
  });

  test("/manifest.webmanifest is served as a web app manifest", async () => {
    const file = installFile("/manifest.webmanifest");
    expect(JSON.parse(file.source)).toEqual(webManifest());
    const headers = await staticHeaders("/manifest.webmanifest");
    expect(headers.get("content-type")).toBe("application/manifest+json");
  });

  test("/sw.js is a worker allowed to control the whole app", async () => {
    const file = installFile("/sw.js");
    expect(file.contentType).toContain("text/javascript");
    expect(file.source).toContain('addEventListener("fetch"');
    const headers = await staticHeaders("/sw.js");
    expect(headers.get("service-worker-allowed")).toBe("/");
    expect(headers.get("cache-control")).toBe("no-cache");
  });
});

describe("/share without the service worker", () => {
  const post = (form: FormData) =>
    handleShareAction(
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

  test("a visit, not a share, goes to the library", () => {
    const response = handleShareVisit(new Request("https://teak.test/share"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://teak.test/");
  });
});
