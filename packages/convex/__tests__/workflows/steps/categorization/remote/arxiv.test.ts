import { describe, expect, test } from "bun:test";
import {
  arxivApiUrl,
  fetchArxivDetails,
  isArxivPdfUrl,
  parseArxivAtom,
  parseArxivId,
} from "../../../../../workflows/steps/categorization/remote/arxiv";
import {
  richSiteFixture,
  xmlResponse,
} from "../../../../helpers/richSites.test-utils";
import { socialFetch } from "../../../../helpers/socialFetch.test-utils";

const answer = (id: string, fixture: string) =>
  socialFetch((url) =>
    url === arxivApiUrl(id) ? xmlResponse(richSiteFixture(fixture)) : undefined
  );

describe("parseArxivId", () => {
  test.each([
    ["https://arxiv.org/abs/1706.03762", "1706.03762"],
    ["https://arxiv.org/abs/1706.03762v7", "1706.03762v7"],
    ["https://arxiv.org/pdf/2401.12345", "2401.12345"],
    ["https://arxiv.org/pdf/2401.12345v2.pdf", "2401.12345v2"],
    ["https://www.arxiv.org/abs/hep-th/9901001", "hep-th/9901001"],
    ["https://arxiv.org/abs/math.GT/0309136", "math.GT/0309136"],
    ["https://export.arxiv.org/abs/hep-th/9901001v3", "hep-th/9901001v3"],
  ])("reads %s", (url: string, id: string) => {
    expect(parseArxivId(url)).toBe(id);
  });

  test.each([
    "https://arxiv.org/abs/1706.03762,1706.03763",
    "https://arxiv.org/abs/1706.03762&id_list=1",
    "https://arxiv.org/abs/../../api/query",
    "https://arxiv.org/list/cs.CL/recent",
    "https://arxiv.org/abs/",
    "https://arxiv.org.example.com/abs/1706.03762",
    "https://example.com/abs/1706.03762",
  ])("ignores %s", (url: string) => {
    expect(parseArxivId(url)).toBeNull();
  });

  test("the API gets one encoded id", () => {
    expect(arxivApiUrl("hep-th/9901001")).toBe(
      "https://export.arxiv.org/api/query?id_list=hep-th%2F9901001"
    );
  });

  test("only arxiv.org/pdf/<id> counts as a paper's PDF", () => {
    expect(isArxivPdfUrl("https://arxiv.org/pdf/1706.03762")).toBe(true);
    expect(isArxivPdfUrl("https://arxiv.org/pdf/hep-th/9901001")).toBe(true);
    expect(isArxivPdfUrl("https://arxiv.org/abs/1706.03762")).toBe(false);
    expect(isArxivPdfUrl("https://export.arxiv.org/pdf/1706.03762")).toBe(
      false
    );
    expect(isArxivPdfUrl("https://arxiv.org/pdf/1706.03762?x=1")).toBe(false);
    expect(isArxivPdfUrl("https://evil.example/pdf/1706.03762")).toBe(false);
  });
});

describe("fetchArxivDetails", () => {
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
