import { describe, expect, test } from "bun:test";
import { isArxivPdfUrl, parseArxivId } from "../../../shared/utils/arxiv";

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
