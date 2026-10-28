import { describe, expect, test } from "bun:test";
import { validateTextCardContent } from "../../card/markdown";
import {
  cleanEmailLink,
  cleanEmailSubject,
  type EmailCardPlan,
  planEmailCards,
} from "../../inbound/emailContent";
import { MARKDOWN_CONTENT_MAX_BYTES } from "../../shared/markdown";

// What a saved email becomes: one link, or a Markdown note headed by its
// subject, with forwarding noise, trackers and redirect wrappers removed.

const plan = (email: {
  html?: string | null;
  subject?: string | null;
  text?: string | null;
}): EmailCardPlan =>
  planEmailCards({
    html: email.html ?? null,
    subject: email.subject ?? null,
    text: email.text ?? null,
  });

const markdownOf = (result: EmailCardPlan): string => {
  if (result.kind !== "text") {
    throw new Error(`expected a text card, got ${result.kind}`);
  }
  return result.markdown;
};

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

describe("cleanEmailSubject", () => {
  test.each([
    ["Fwd: Re: FW: hello", "hello"],
    ["RE: re: Fwd:   spaced   out ", "spaced out"],
    ["WG: AW: Test", "Test"],
    ["TR: RV: SV: VS: Doorst: Notes", "Notes"],
    ["転送: x", "x"],
    ["回复：答复: 转发: 周报", "周报"],
    ["Re[2]: Budget", "Budget"],
    ["Fwd:", ""],
    ["Reading list", "Reading list"],
    ["Fwdx: not a prefix", "Fwdx: not a prefix"],
    ["مرحبا بالعالم", "مرحبا بالعالم"],
    ["週報 🎉 launch", "週報 🎉 launch"],
  ])("%p → %p", (subject, expected) => {
    expect(cleanEmailSubject(subject)).toBe(expected);
  });
});

describe("cleanEmailLink", () => {
  test.each([
    [
      "Google /url?q=",
      "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpost&sa=D&ust=1",
      "https://example.com/post",
    ],
    [
      "Outlook safelinks",
      "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fdoc%3Futm_source%3Doutlook&data=05%7C01",
      "https://example.org/doc",
    ],
    [
      "a click tracker carrying the destination",
      "https://example.us1.list-manage.com/track/click?u=abc123&id=def&url=https%3A%2F%2Fexample.net%2Fa%3Fmc_cid%3D1%26mc_eid%3D2%26keep%3Dyes",
      "https://example.net/a?keep=yes",
    ],
    [
      "a wrapper inside a wrapper",
      "https://t.example/r?redirect=https%3A%2F%2Fwww.google.com%2Furl%3Fq%3Dhttps%253A%252F%252Fexample.com%252Fdeep",
      "https://example.com/deep",
    ],
    [
      "an opaque newsletter redirect, tracking stripped",
      "https://substack.com/redirect/2/eyJlIjoiaHR0cHM?utm_medium=email&j=x",
      "https://substack.com/redirect/2/eyJlIjoiaHR0cHM?j=x",
    ],
    [
      "a share link keeps its own destination",
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com%2Fpost",
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com%2Fpost",
    ],
    [
      "a page with a URL in its query keeps it",
      "https://example.com/compare?url=https%3A%2F%2Fexample.org%2F",
      "https://example.com/compare?url=https%3A%2F%2Fexample.org%2F",
    ],
    [
      "a search whose q is not a URL",
      "https://www.google.com/search?q=cats",
      "https://www.google.com/search?q=cats",
    ],
  ])("%s", (_name, raw, expected) => {
    expect(cleanEmailLink(raw)).toBe(expected);
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "mailto:a@example.com",
    "not a url",
  ])("%p is not a link", (raw) => {
    expect(cleanEmailLink(raw)).toBeNull();
  });

  test("never unwraps into a javascript: URL", () => {
    expect(
      cleanEmailLink("https://t.example/r?url=javascript%3Aalert(1)")
    ).toBe("https://t.example/r?url=javascript%3Aalert(1)");
  });
});

describe("planEmailCards: link or text", () => {
  test("a bare link is a link card", () => {
    expect(
      plan({ subject: "Read this", text: "https://example.com/a\n" })
    ).toEqual({ kind: "link", url: "https://example.com/a" });
  });

  test("a link and a sentence is a link card with the sentence as notes", () => {
    expect(
      plan({
        subject: "Fwd: worth a look",
        text: "Thought you'd like this: https://example.com/a?utm_source=x.\n\nSent from my iPhone",
      })
    ).toEqual({
      kind: "link",
      notes: "Thought you'd like this:",
      url: "https://example.com/a",
    });
  });

  test("a plain-text link written as <url> leaves no brackets in the notes", () => {
    expect(
      plan({
        html: '<p>Worth a read: <a href="https://example.com/post">this post</a></p>',
        text: "Worth a read: this post <https://example.com/post?utm_medium=email>\n",
      })
    ).toEqual({
      kind: "link",
      notes: "Worth a read: this post",
      url: "https://example.com/post",
    });
  });

  test("an HTML body with an escaped <url> gives the link without its brackets", () => {
    expect(
      plan({
        html: "<p>Worth a read: &lt;https://example.com/a?b=1&gt;</p>",
      })
    ).toEqual({
      kind: "link",
      notes: "Worth a read:",
      url: "https://example.com/a?b=1",
    });
  });

  test("an HTML body that is one linked phrase is a link card", () => {
    expect(
      plan({
        html: '<div dir="ltr"><a href="https://www.google.com/url?q=https://example.com/story">A great story</a></div>',
      })
    ).toEqual({
      kind: "link",
      notes: "A great story",
      url: "https://example.com/story",
    });
  });

  test("a link with more than 280 characters of text is a text card", () => {
    const words = "word ".repeat(60).trim();
    const result = plan({
      subject: "Long",
      text: `${words}\nhttps://example.com/a`,
    });
    expect(result.kind).toBe("text");
    expect(markdownOf(result)).toContain("https://example.com/a");
  });

  test("two links make a text card", () => {
    const result = plan({
      subject: "Links",
      text: "https://example.com/a\nhttps://example.com/b",
    });
    expect(markdownOf(result)).toBe(
      "# Links\n\nhttps://example.com/a\nhttps://example.com/b"
    );
  });

  test("the same link twice is still one link", () => {
    expect(
      plan({ text: "https://example.com/a https://example.com/a?utm_source=e" })
    ).toEqual({ kind: "link", url: "https://example.com/a" });
  });

  test("an empty body with a subject is a heading-only note", () => {
    expect(plan({ subject: "Fwd: Call mom", text: "  \n " })).toEqual({
      kind: "text",
      markdown: "# Call mom",
    });
  });

  test("nothing at all is empty", () => {
    expect(plan({ html: "<p>&nbsp;</p>", subject: "Fwd:", text: "" })).toEqual({
      kind: "empty",
    });
    expect(plan({})).toEqual({ kind: "empty" });
  });

  test.each([
    ["RTL", "مرحبا بالعالم", "# مرحبا بالعالم"],
    ["CJK", "週報：第三四半期", "# 週報：第三四半期"],
    ["emoji", "Re: 🎉 Launch day 🚀", "# 🎉 Launch day 🚀"],
  ])("a %s subject heads the note", (_name, subject, heading) => {
    expect(markdownOf(plan({ subject, text: "Notes for later." }))).toBe(
      `${heading}\n\nNotes for later.`
    );
  });
});

describe("planEmailCards: bodies", () => {
  test("text/plain wins over HTML when it says anything", () => {
    expect(
      markdownOf(
        plan({
          html: "<p><b>From HTML</b></p>",
          subject: "Both",
          text: "From the text part.",
        })
      )
    ).toBe("# Both\n\nFrom the text part.");
  });

  test("the HTML is used when the text part is blank", () => {
    expect(
      markdownOf(
        plan({ html: "<p><b>From HTML</b></p>", subject: "Both", text: " \n" })
      )
    ).toBe("# Both\n\n**From HTML**");
  });

  test("HTML becomes Markdown", () => {
    const html = `<html><head><title>Ignored</title><style>p { color: red }</style>
<script>alert(1)</script></head><body>
<h2>Section <em>one</em></h2>
<p>Hello <b>world</b>, *not emphasis* and snake_case.<br>Second line</p>
<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
<ol start="3"><li>Third</li><li>Fourth</li></ol>
<blockquote><p>Quoted</p><p>Again</p></blockquote>
<pre>const a = 1;
  indented();</pre>
<p>Inline <code>x_y</code> and <s>gone</s>.</p>
<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apples</td><td>3</td></tr></table>
<hr><p>Fish &amp; chips &lt;3</p></body></html>`;
    expect(markdownOf(plan({ html }))).toBe(
      [
        "## Section *one*",
        "Hello **world**, \\*not emphasis\\* and snake\\_case.  \nSecond line",
        "- One\n- Two\n  - Nested",
        "3. Third\n4. Fourth",
        "> Quoted\n>\n> Again",
        "```\nconst a = 1;\n  indented();\n```",
        "Inline `x_y` and ~~gone~~.",
        "Name | Qty\n\nApples | 3",
        "---",
        "Fish & chips \\<3",
      ].join("\n\n")
    );
  });

  test("a newsletter loses its pixels, hidden text and redirect wrappers", () => {
    const pixels = Array.from(
      { length: 40 },
      (_, index) =>
        `<img src="https://t.example/open/${index}.gif" width="1" height="1" alt="">`
    ).join("");
    const html = `<body>
<div style="display:none;max-height:0;overflow:hidden">Preview text&zwnj;&nbsp;&zwnj;&nbsp;</div>
<span hidden>hidden span</span>
<div style="mso-hide:all">Outlook only</div>
${pixels}
<table width="600"><tr><td>
  <a href="https://example.com/"><img src="https://cdn.example/logo.png"></a>
  <h1>This week</h1>
  <p>Read <a href="https://example.us1.list-manage.com/track/click?u=1&id=2&url=https%3A%2F%2Fblog.example%2Fpost%3Futm_campaign%3Dw">the post</a>,
  the <a href="https://www.google.com/url?q=https%3A%2F%2Fdocs.example%2Fguide&sa=D">guide</a> and
  the <a href="https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnews.example%2Fitem%3Fmc_eid%3Dx&data=1">news</a>.</p>
  <p><a href="https://substack.com/redirect/abc?utm_source=substack&j=1">Substack link</a></p>
</td></tr></table></body>`;
    const markdown = markdownOf(plan({ html, subject: "Weekly" }));
    expect(markdown).toBe(
      [
        "# Weekly",
        "# This week",
        "Read [the post](https://blog.example/post), the [guide](https://docs.example/guide) and the [news](https://news.example/item).",
        "[Substack link](https://substack.com/redirect/abc?j=1)",
      ].join("\n\n")
    );
    expect(markdown).not.toContain("t.example");
    expect(markdown).not.toContain("Preview text");
  });

  test("a javascript: link keeps its text and loses the link", () => {
    expect(
      markdownOf(
        plan({
          html: '<p><a href="javascript:alert(1)">Click me</a> and <a href="data:text/html,x">this</a></p>',
          subject: "s",
        })
      )
    ).toBe("# s\n\nClick me and this");
  });

  test("a five-level forward chain keeps only what was written", () => {
    let text = "The original note.";
    for (let level = 5; level >= 1; level--) {
      text = `Comment ${level}\n\n---------- Forwarded message ---------\nFrom: Person ${level} <p${level}@example.com>\nDate: Mon, 13 Oct 2026 at 09:0${level}\nSubject: Fwd: chain\nTo: <me@example.com>\n\n${text}`;
    }
    const markdown = markdownOf(
      plan({ subject: "Fwd: Fwd: Fwd: Fwd: Fwd: chain", text })
    );
    expect(markdown).toBe(
      "# chain\n\nComment 1\n\nComment 2\n\nComment 3\n\nComment 4\n\nComment 5\n\nThe original note."
    );
  });

  test.each([
    [
      "Gmail HTML",
      `<div dir="ltr">See below</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername">Ann</strong> <span>&lt;<a href="mailto:ann@example.com">ann@example.com</a>&gt;</span><br>Date: Tue, Oct 14, 2026<br>Subject: Plans<br>To: &lt;me@example.com&gt;<br></div><br><br><div dir="ltr">Original body</div></div>`,
    ],
    [
      "Outlook HTML",
      `<p>See below</p><div style="border:none;border-top:solid #E1E1E1 1.0pt"><p><b>From:</b> Ann &lt;ann@example.com&gt;<br><b>Sent:</b> Tuesday, October 14, 2026 9:30 AM<br><b>To:</b> Me<br><b>Subject:</b> Plans</p></div><p>Original body</p>`,
    ],
    [
      "Apple Mail HTML",
      `<div>See below</div><div><br><blockquote type="cite"><div>Begin forwarded message:</div><br><div><b>From: </b>Ann &lt;ann@example.com&gt;</div><div><b>Subject: </b>Plans</div><div><b>Date: </b>14 October 2026</div><div><b>To: </b>Me</div><br><div>Original body</div></blockquote></div>`,
    ],
  ])("%s forward headers are removed", (_name, html) => {
    const markdown = markdownOf(plan({ html, subject: "Fwd: Plans" }));
    expect(markdown).toContain("See below");
    expect(markdown).toContain("Original body");
    expect(markdown).not.toMatch(/From:|Subject:|Forwarded|ann@example/u);
  });

  test("Outlook plain text forward headers are removed", () => {
    const text = [
      "FYI",
      "",
      "________________________________",
      "From: Ann <ann@example.com>",
      "Sent: Tuesday, October 14, 2026 9:30 AM",
      "To: Me <me@example.com>",
      "Subject: Plans",
      "",
      "Original body",
    ].join("\r\n");
    expect(markdownOf(plan({ subject: "FW: Plans", text }))).toBe(
      "# Plans\n\nFYI\n\nOriginal body"
    );
  });

  test("a line that only mentions From: stays", () => {
    expect(
      markdownOf(plan({ subject: "s", text: "From: the archive, page 3." }))
    ).toBe("# s\n\nFrom: the archive, page 3.");
  });

  test("a signature after '-- ' is dropped", () => {
    expect(
      markdownOf(
        plan({ subject: "s", text: "Body text\n\n-- \nAnn\nCEO, Example" })
      )
    ).toBe("# s\n\nBody text");
  });

  // Apple Mail's share layout (Share > Mail from Safari, and messages a script
  // asks Mail to write) quotes the whole body, and its plain text marks each
  // inline attachment with U+FFFC.
  const appleShareHtml = (inner: string) =>
    `<html aria-label="message body"><body><div class="Apple-Mail-URLShareUserContentTopClass"><br></div><div class="Apple-Mail-URLShareWrapperClass" style="position: relative !important;"><blockquote type="cite" style="border-left-style: none;">${inner}</blockquote></div></body></html>`;

  test("an Apple Mail shared link is a link card with its sentence, unquoted", () => {
    expect(
      plan({
        html: appleShareHtml("Worth a read: https://example.com/essay"),
        subject: "Shared",
        text: "\n> Worth a read: https://example.com/essay\n",
      })
    ).toEqual({
      kind: "link",
      notes: "Worth a read:",
      url: "https://example.com/essay",
    });
  });

  test("an Apple Mail note with an attachment loses the quote and the placeholder", () => {
    expect(
      markdownOf(
        plan({
          html: appleShareHtml("<p>Notes from the trip, map attached.</p>"),
          subject: "Trip",
          text: "\n> Notes from the trip, map attached.\n￼",
        })
      )
    ).toBe("# Trip\n\nNotes from the trip, map attached.");
  });

  test("an Apple Mail share with no text part is unquoted from its HTML", () => {
    expect(
      plan({
        html: appleShareHtml("Worth a read: https://example.com/essay"),
        subject: "Shared",
        text: null,
      })
    ).toEqual({
      kind: "link",
      notes: "Worth a read:",
      url: "https://example.com/essay",
    });
  });

  test("a reply quoting an earlier Apple Mail share keeps its quotes", () => {
    const markdown = markdownOf(
      plan({
        html: `<p>Agreed.</p><blockquote type="cite">${appleShareHtml("Notes from the trip.")}</blockquote>`,
        subject: "Re: trip",
        text: "Agreed.\n\n> > Notes from the trip.",
      })
    );
    expect(markdown).toContain("Agreed.");
    expect(markdown).toContain("> > Notes from the trip.");
  });

  test("an Apple Mail share drops its signature after unquoting", () => {
    expect(
      markdownOf(
        plan({
          html: appleShareHtml("<p>Body text</p><p>-- <br>Ann</p>"),
          subject: "s",
          text: "\n> Body text\n> -- \n> Ann\n",
        })
      )
    ).toBe("# s\n\nBody text");
  });

  test("a text part holding only an attachment marker falls back to the HTML", () => {
    expect(
      markdownOf(
        plan({ html: "<p>Real words here</p>", subject: "s", text: "￼\n" })
      )
    ).toBe("# s\n\nReal words here");
  });

  test("a reply's quote stays when it isn't Apple Mail's share layout", () => {
    expect(
      markdownOf(
        plan({
          html: '<p>Agreed.</p><blockquote type="cite">Shall we go?</blockquote>',
          subject: "Re: plan",
          text: "Agreed.\n\n> Shall we go?",
        })
      )
    ).toBe("# plan\n\nAgreed.\n\n> Shall we go?");
  });

  test("malformed HTML is read without throwing", () => {
    const markdown = markdownOf(
      plan({
        html: "<div><p>Unclosed <b>bold <i>both</p><table><td>cell<li>item</ul></div></span>",
        subject: "Broken",
      })
    );
    expect(markdown).toContain("Unclosed");
    expect(markdown).toContain("cell");
  });

  test("very deep nesting is read as text", () => {
    const html = `${"<div><span>".repeat(5000)}deep text${"</span></div>".repeat(5000)}`;
    expect(markdownOf(plan({ html, subject: "Deep" }))).toBe(
      "# Deep\n\ndeep text"
    );
  });
});

describe("planEmailCards: size", () => {
  test("a body past the text card cap is cut to valid UTF-8 that fits", () => {
    // Multi-byte characters, so a naive byte cut would split one.
    const text = "é漢🎉".repeat(80_000);
    const markdown = markdownOf(plan({ subject: "Big", text }));
    expect(byteLength(markdown)).toBeLessThanOrEqual(
      MARKDOWN_CONTENT_MAX_BYTES
    );
    expect(markdown.endsWith("…")).toBe(true);
    expect(markdown).not.toContain("�");
    expect(
      new TextDecoder("utf-8", { fatal: true }).decode(
        new TextEncoder().encode(markdown)
      )
    ).toBe(markdown);
    expect(validateTextCardContent(markdown)).toBe(markdown);
  });

  test("a body under the cap is kept whole", () => {
    const text = "a".repeat(1000);
    expect(markdownOf(plan({ subject: "s", text }))).toBe(`# s\n\n${text}`);
  });

  test.each([
    ["a text body", { text: `Start${" ".repeat(200_000)}end, and more.` }],
    ["a text body with tabs", { text: `Start${" \t".repeat(100_000)}end` }],
    [
      "an HTML body",
      { html: `<p>Start${"&nbsp;".repeat(100_000)}<br>end</p>` },
    ],
  ])("%s with a long run of spaces converts in under a second", (_, body) => {
    const started = performance.now();
    const result = plan({ ...body, subject: "Spaces" });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(markdownOf(result)).toContain("Start");
  });

  test("a 2 MB HTML body converts in under a second", () => {
    const paragraph =
      '<p>Lorem <b>ipsum</b> dolor <a href="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fp">sit</a> amet, <i>consectetur</i> adipiscing.</p>';
    const html = `<html><body>${paragraph.repeat(Math.ceil((2 * 1024 * 1024) / paragraph.length))}</body></html>`;
    const started = performance.now();
    const result = plan({ html, subject: "Perf" });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(validateTextCardContent(markdownOf(result))).toBe(
      markdownOf(result)
    );
  });
});
