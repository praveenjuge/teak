"use client";

import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import type { FileFormat } from "@teak/convex/shared/file-formats";
import { Highlight, type Language, themes } from "prism-react-renderer";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";

const MAX_BROWSER_PREVIEW_BYTES = 1024 * 1024;
const LANGUAGE_CLASS_REGEX = /language-([\w-]+)/u;
const SUPPORTED_LANGUAGES: Record<string, Language> = {
  css: "css",
  html: "markup",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  markdown: "markdown",
  markup: "markup",
  mdx: "markup",
  text: "plain",
  tsx: "tsx",
  typescript: "typescript",
};

interface SourceCodePreviewProps {
  code: string;
  language?: string;
}

const prismLanguage = (language?: string): Language =>
  (language && SUPPORTED_LANGUAGES[language]) || "plain";

const withStableKeys = <T,>(
  values: readonly T[],
  keyFor: (value: T) => string
): Array<{ key: string; value: T }> => {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const baseKey = keyFor(value);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return { key: `${baseKey}-${occurrence}`, value };
  });
};

const tokenKey = (token: { content: string; types: string[] }): string =>
  `${token.types.join("-")}:${token.content}`;

export function SourceCodePreview({ code, language }: SourceCodePreviewProps) {
  return (
    <Highlight
      code={code}
      language={prismLanguage(language)}
      theme={themes.vsDark}
    >
      {({ className, getLineProps, getTokenProps, style, tokens }) => (
        <pre
          className={`${className} max-h-[70vh] overflow-auto rounded-lg p-4 font-mono text-xs leading-5`}
          style={style}
        >
          {withStableKeys(tokens, (line) => line.map(tokenKey).join("|")).map(
            ({ key: lineKey, value: line }) => (
              <div key={lineKey} {...getLineProps({ line })}>
                {withStableKeys(line, tokenKey).map(({ key, value: token }) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            )
          )}
        </pre>
      )}
    </Highlight>
  );
}

export function SafeMarkdownPreview({ source }: { source: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
      <Markdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noopener noreferrer">
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const language = LANGUAGE_CLASS_REGEX.exec(className ?? "")?.[1];
            const code = String(children).replace(/\n$/u, "");
            return language ? (
              <SourceCodePreview code={code} language={language} />
            ) : (
              <code>{children}</code>
            );
          },
        }}
        skipHtml
      >
        {source}
      </Markdown>
      <details className="mt-4 rounded-lg border p-3">
        <summary className="cursor-pointer font-medium text-sm">Source</summary>
        <div className="mt-3">
          <SourceCodePreview code={source} language="markdown" />
        </div>
      </details>
    </div>
  );
}

interface FileTextPreviewProps {
  fileUrl: string;
  format: FileFormat;
}

interface LoadFileTextPreviewOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  signal?: AbortSignal;
}

export async function loadFileTextPreview(
  fileUrl: string,
  options: LoadFileTextPreviewOptions = {}
): Promise<string | null> {
  const maxBytes = options.maxBytes ?? MAX_BROWSER_PREVIEW_BYTES;
  const response = await (options.fetchImpl ?? fetch)(fileUrl, {
    credentials: "omit",
    signal: options.signal,
  });
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    (Number.isFinite(contentLength) && contentLength > maxBytes)
  ) {
    await response.body?.cancel();
    return null;
  }
  return readResponseTextWithinLimit(response, maxBytes);
}

export function FileTextPreview({ fileUrl, format }: FileTextPreviewProps) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSource(null);

    void (async () => {
      try {
        const text = await loadFileTextPreview(fileUrl, {
          signal: controller.signal,
        });
        if (text !== null) {
          setSource(text);
        }
      } catch {
        // File facts remain visible when source loading is unavailable.
      }
    })();

    return () => controller.abort();
  }, [fileUrl]);

  if (source === null) {
    return null;
  }

  return format.preview === "markdown" ? (
    <SafeMarkdownPreview source={source} />
  ) : (
    <SourceCodePreview code={source} language={format.language} />
  );
}
