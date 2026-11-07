import { describe, expect, test } from "bun:test";
import { richSiteFixture, xmlResponse } from "../../../test/richSites";
import { socialFetch } from "../../../test/socialFetch";
import { arxivApiUrl, fetchArxivDetails, parseArxivAtom } from "./arxiv";

const answer = (id: string, fixture: string) =>
  socialFetch((url) =>
    url === arxivApiUrl(id) ? xmlResponse(richSiteFixture(fixture)) : undefined
  );

describe("fetchArxivDetails", () => {
  test("the API gets one encoded id", () => {
    expect(arxivApiUrl("hep-th/9901001")).toBe(
      "https://export.arxiv.org/api/query?id_list=hep-th%2F9901001"
    );
  });

  test("reads a new-style paper's facts, abstract and PDF", async () => {
    const { deps, requests } = answer("1706.03762", "arxiv-new.xml");

    const details = await fetchArxivDetails(
      "https://arxiv.org/abs/1706.03762",
      deps
    );

    expect(requests).toEqual([arxivApiUrl("1706.03762")]);
    expect(details?.facts).toEqual([
      {
        label: "Authors",
        value: "Ashish Vaswani, Noam Shazeer, Niki Parmar et al.",
      },
      { label: "Published", value: "Jun 12, 2017" },
      { label: "Subject", value: "cs.CL" },
    ]);
    expect(details?.summary).toStartWith("The dominant sequence transduction");
    expect(details?.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
  });

  test("reads an old-style paper with its DOI, from its PDF URL", async () => {
    const { deps } = answer("hep-th/9901001v3", "arxiv-old.xml");

    const details = await fetchArxivDetails(
      "https://arxiv.org/pdf/hep-th/9901001v3",
      deps
    );

    expect(details?.facts).toEqual([
      { label: "Authors", value: "Yosuke Imamura" },
      { label: "Published", value: "Jan 1, 1999" },
      { label: "Subject", value: "hep-th" },
      { label: "DOI", value: "10.1143/PTP.101.1155" },
    ]);
    expect(details?.pdfUrl).toBe("https://arxiv.org/pdf/hep-th/9901001");
  });

  test("a withdrawn paper has no PDF to save", async () => {
    const { deps } = answer("0910.4008", "arxiv-withdrawn.xml");

    const details = await fetchArxivDetails(
      "https://arxiv.org/abs/0910.4008",
      deps
    );

    expect(details?.facts?.[0]).toEqual({
      label: "Authors",
      value: "Matthew Daws",
    });
    expect(details?.pdfUrl).toBeUndefined();
  });

  test("300 authors read as the first three et al.", async () => {
    const { deps } = answer("2101.00001", "arxiv-many-authors.xml");

    const details = await fetchArxivDetails(
      "https://arxiv.org/abs/2101.00001",
      deps
    );

    expect(details?.facts?.[0]).toEqual({
      label: "Authors",
      value: "Author 1, Author 2, Author 3 et al.",
    });
  });

  test("an unknown id gives nothing", async () => {
    const errorFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1</id><title>Error</title><summary>incorrect id format for 1</summary></entry></feed>`;
    const { deps } = socialFetch(() => xmlResponse(errorFeed));

    expect(
      await fetchArxivDetails("https://arxiv.org/abs/9999.99999", deps)
    ).toBeNull();
    expect(
      parseArxivAtom(`<feed xmlns="http://www.w3.org/2005/Atom"></feed>`)
    ).toBeNull();
  });

  test("without an API slot nothing is requested", async () => {
    const { deps, requests } = answer("1706.03762", "arxiv-new.xml");

    const details = await fetchArxivDetails(
      "https://arxiv.org/abs/1706.03762",
      { ...deps, takeArxivSlot: async () => false }
    );

    expect(details).toBeNull();
    expect(requests).toEqual([]);
  });

  test.each([
    ["a server error", () => new Response("down", { status: 503 })],
    ["markup that isn't Atom", () => xmlResponse("<html><body>Hi</body>")],
    ["an empty body", () => xmlResponse("")],
  ])("%s gives nothing", async (_name: string, respond: () => Response) => {
    const { deps } = socialFetch(() => respond());

    expect(
      await fetchArxivDetails("https://arxiv.org/abs/1706.03762", deps)
    ).toBeNull();
  });
});
