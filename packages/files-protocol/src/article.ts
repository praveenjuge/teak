/** `extract-article`: the article in a link's saved copy, as Markdown. */
export interface FilesExtractArticleParams {
  /** The copy: `<prefix>users/<hash>/cards/<card id>/page-archive/<id>-archive.html`. */
  archiveKey: string;
  /** The page the copy is of, for links and images with relative URLs. */
  pageUrl: string;
}

/**
 * An image the article shows, re-encoded as WebP at most 1600 px wide. Its
 * place in `images` is the `<n>` of the `teak-image:<n>` references in the
 * Markdown.
 */
export interface FilesArticleImage {
  base64: string;
  bytes: number;
  contentType: "image/webp";
}

/**
 * The op writes nothing: the workflow step registers each object to the
 * account before it writes it, and names the objects by their content.
 */
export type FilesExtractArticleResult =
  | {
      byline?: string;
      dir?: "ltr" | "rtl";
      images: FilesArticleImage[];
      kind: "article";
      lang?: string;
      /** Images are `teak-image:<n>`; at most 512 KiB characters. */
      markdown: string;
      title?: string;
      /** The Markdown was cut to fit. */
      truncated: boolean;
      wordCount: number;
    }
  | {
      kind: "none";
      reason: "no_content" | "not_readerable" | "too_short";
      wordCount: number;
    }
  /** The copy isn't in storage any more. */
  | { kind: "missing" };
