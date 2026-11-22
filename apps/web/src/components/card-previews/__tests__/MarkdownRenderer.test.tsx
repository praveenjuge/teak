import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../MarkdownRenderer";

const html = (source: string) =>
  renderToStaticMarkup(<div>{renderMarkdown(source)}</div>);

describe("renderMarkdown", () => {
  test("renders a GFM table with alignment", () => {
    const out = html("| a | b |\n|:-|-:|\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain('<th align="left">a</th>');
    expect(out).toContain('<td align="right">2</td>');
  });

  test("renders task lists with disabled checkboxes", () => {
    const out = html("- [x] done\n- [ ] todo");
    expect(out).toContain('<ul class="contains-task-list">');
    expect(out).toContain('<li class="task-list-item"><input');
    expect(out).toContain('checked=""');
    expect(out).toContain("disabled");
  });

  test("keeps strikethrough and autolinks", () => {
    const out = html("~~old~~ https://example.com");
    expect(out).toContain("<del>old</del>");
    expect(out).toContain('<a href="https://example.com">');
  });

  test("drops unsafe links but keeps their text", () => {
    const out = html(
      "[bad](javascript:alert(1)) [ok](https://a.test) [rel](/x) [mail](mailto:a@b.c)"
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain("bad");
    expect(out).toContain('href="https://a.test"');
    expect(out).toContain('href="/x"');
    expect(out).toContain('href="mailto:a@b.c"');
  });

  test("does not render raw HTML", () => {
    const out = html("<script>alert(1)</script>\n\nA <b>bold</b> word");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<b>");
    expect(out).toContain("bold");
  });

  test("puts the language on a code block", () => {
    expect(html("```ts\nlet a = 1;\n```")).toContain(
      '<pre><code class="language-ts">let a = 1;\n</code></pre>'
    );
  });

  test("renders footnotes after the content", () => {
    const out = html("A claim[^1].\n\n[^1]: The source.");
    expect(out).toContain("<sup><a");
    expect(out).toContain("Footnotes");
    expect(out).toContain("The source.");
  });

  test("demotes h1 and drops an opening heading that repeats the title", () => {
    const out = renderToStaticMarkup(
      <div>
        {renderMarkdown("# Title\n\n# Other", {
          demoteH1: true,
          openingTitle: "title",
        })}
      </div>
    );
    expect(out).not.toContain("Title");
    expect(out).toContain("<h2>Other</h2>");
  });
});
