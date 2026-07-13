"use client";

import type { FileFormat } from "@teak/convex/shared/file-formats";
import { Skeleton } from "@teak/ui/components/ui/skeleton";
import { Highlight, type Language, themes } from "prism-react-renderer";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import {
  cachedFileTextPreview,
  requestFileTextPreview,
} from "./fileTextPreviewCache";

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
          data-not-typeset
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
    <div className="typeset typeset-docs max-w-[37em] pb-6">
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
          pre: ({ children }) => children,
        }}
        skipHtml
      >
        {source}
      </Markdown>
    </div>
  );
}

interface FileTextPreviewProps {
  fileKey?: string;
  fileUrl: string;
  format: FileFormat;
}

function MarkdownPreviewSkeleton() {
  return (
    <div
      aria-label="Loading file preview"
      className="flex max-w-[37em] flex-col gap-3 pb-6"
      role="status"
    >
      <Skeleton aria-hidden="true" className="h-7 w-2/5" />
      <Skeleton aria-hidden="true" className="h-4 w-full" />
      <Skeleton aria-hidden="true" className="h-4 w-11/12" />
      <Skeleton aria-hidden="true" className="h-6 w-1/3" />
      <Skeleton aria-hidden="true" className="h-4 w-10/12" />
      <Skeleton aria-hidden="true" className="h-4 w-3/4" />
    </div>
  );
}

export function FileTextPreview({
  fileKey,
  fileUrl,
  format,
}: FileTextPreviewProps) {
  const cacheKey = fileKey ?? fileUrl;
  const initialSource = cachedFileTextPreview(cacheKey);
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [isLoading, setIsLoading] = useState(initialSource === undefined);

  useEffect(() => {
    let active = true;
    const cached = cachedFileTextPreview(cacheKey);
    if (cached !== undefined) {
      setSource(cached);
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setSource(null);
    setIsLoading(true);

    void (async () => {
      try {
        const text = await requestFileTextPreview({ cacheKey, fileUrl });
        if (active && text !== null) {
          setSource(text);
        }
      } catch {
        // File facts remain visible when source loading is unavailable.
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [cacheKey, fileUrl]);

  if (source === null) {
    return isLoading ? <MarkdownPreviewSkeleton /> : null;
  }

  return format.preview === "markdown" ? (
    <SafeMarkdownPreview source={source} />
  ) : (
    <SourceCodePreview code={source} language={format.language} />
  );
}
