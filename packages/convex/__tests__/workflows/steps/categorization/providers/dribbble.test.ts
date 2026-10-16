import { describe, expect, test } from "bun:test";
import { enrichDribbble } from "../../../../../../convex/workflows/steps/categorization/providers/dribbble";

describe("enrichDribbble", () => {
  test("handles full stats extraction (Likes, Views, Comments) to cover mapLabelToStat", () => {
    const rawMap = new Map([
      [
        "meta[name='twitter:label1']",
        { attributes: [{ name: "content", value: "Likes" }] },
      ],
      [
        "meta[name='twitter:data1']",
        { attributes: [{ name: "content", value: "10" }] },
      ],
      [
        "meta[name='twitter:label2']",
        { attributes: [{ name: "content", value: "Views" }] },
      ],
      [
        "meta[name='twitter:data2']",
        { attributes: [{ name: "content", value: "20" }] },
      ],
      [
        "meta[name='twitter:label3']",
        { attributes: [{ name: "content", value: "Comments" }] },
      ],
      [
        "meta[name='twitter:data3']",
        { attributes: [{ name: "content", value: "30" }] },
      ],
      [
        "meta[name='twitter:label4']",
        { attributes: [{ name: "content", value: "Unknown" }] },
      ],
      [
        "meta[name='twitter:data4']",
        { attributes: [{ name: "content", value: "99" }] },
      ],
    ]);
    const result = enrichDribbble(rawMap);
    expect(result?.facts?.find((f) => f.label === "Likes")?.value).toBe("10");
    expect(result?.facts?.find((f) => f.label === "Views")?.value).toBe("20");
    expect(result?.facts?.find((f) => f.label === "Comments")?.value).toBe(
      "30"
    );
  });

  test("handles keywords extraction with limit logic", () => {
    const rawMap = new Map([
      [
        "meta[name='keywords']",
        { attributes: [{ name: "content", value: "a, b, c, d, e, f" }] },
      ],
    ]);
    const result = enrichDribbble(rawMap);
    expect(result?.raw?.keywords).toEqual(["a", "b", "c", "d", "e"]);
    expect(result?.facts?.find((f) => f.label === "Tags")?.value).toBe(
      "a, b, c"
    );
  });

  test("handles designer extraction with valid name", () => {
    const rawMap = new Map([
      [
        "meta[name='author']",
        { attributes: [{ name: "content", value: "John Doe" }] },
      ],
    ]);
    const result = enrichDribbble(rawMap);
    expect(result?.facts?.find((f) => f.label === "Designer")?.value).toBe(
      "John Doe"
    );
  });

  test("handles designer extraction fallback logic", () => {
    const rawMap = new Map([
      [
        "meta[name='author']",
        { attributes: [{ name: "content", value: "   " }] },
      ],
      [
        "meta[property='og:title']",
        {
          attributes: [
            { name: "content", value: "Shot by Jane Doe on Dribbble" },
          ],
        },
      ],
    ]);
    const result = enrichDribbble(rawMap);
    expect(result?.facts?.find((f) => f.label === "Designer")?.value).toBe(
      "Jane Doe"
    );
  });

  test("handles extractStat seeding logic coverage", () => {
    const rawMap = new Map([
      [
        "meta[name='twitter:label1']",
        { attributes: [{ name: "content", value: "Likes" }] },
      ],
      [
        "meta[name='twitter:data1']",
        { attributes: [{ name: "content", value: "10" }] },
      ],
    ]);

    const result = enrichDribbble(rawMap);
    expect(result?.facts?.find((f) => f.label === "Likes")?.value).toBe("10");
  });

  test("handles extractStat fallback to selectors", () => {
    const rawMap = new Map([["a[href$='/likes']", { text: "55" }]]);
    const result = enrichDribbble(rawMap);
    expect(result?.facts?.find((f) => f.label === "Likes")?.value).toBe("55");
  });

  test("handles getFirstAttribute loop coverage", () => {
    const rawMap = new Map([
      [
        "meta[name='parsely-tags']",
        { attributes: [{ name: "content", value: "tag1" }] },
      ],
    ]);
    const result = enrichDribbble(rawMap);
    expect(result?.raw?.keywords).toEqual(["tag1"]);
  });
});
