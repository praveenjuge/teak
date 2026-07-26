import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

export const teakMarkdownSupport = () =>
  markdown({
    base: markdownLanguage,
  });
