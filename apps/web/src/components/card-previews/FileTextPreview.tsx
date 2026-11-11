"use client";

import type { FileFormat } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";
import { common, createLowlight } from "lowlight";
import { type ReactNode, useEffect, useState } from "react";
import Markdown from "react-markdown";
import "./sourceCodePreview.css";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cachedFileTextPreview,
  requestFileTextPreview,
  textPreviewKey,
} from "./fileTextPreviewCache";

const LANGUAGE_CLASS_REGEX = /language-([\w-]+)/u;
const highlighter = createLowlight(common);
const SUPPORTED_LANGUAGES: Record<string, string> = {
  css: "css",
  html: "xml",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  markdown: "markdown",
  markup: "xml",
  mdx: "xml",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
};

type HighlightNode = ReturnType<
  typeof highlighter.highlight
>["children"][number];

const renderHighlightNode = (node: HighlightNode, key: number): ReactNode => {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return null;
  }
  const className = node.properties.className;
  return (
    <span
      className={Array.isArray(className) ? className.join(" ") : undefined}
      key={key}
    >
      {node.children.map(renderHighlightNode)}
    </span>
  );
};

interface SourceCodePreviewProps {
  code: string;
  language?: string;
}

export function SourceCodePreview({ code, language }: SourceCodePreviewProps) {
  const grammar =
    language && Object.hasOwn(SUPPORTED_LANGUAGES, language)
      ? SUPPORTED_LANGUAGES[language]
      : undefined;
  const content = grammar
    ? highlighter.highlight(grammar, code).children.map(renderHighlightNode)
    : code;

  return (
    <pre
      className="source-code-preview max-h-[70vh] overflow-auto rounded-xl p-4 font-mono text-xs leading-5"
      data-not-typeset
    >
      <code>{content}</code>
    </pre>
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
  const t = useTranslations("cardPreviews.fileText");
  return (
    <div
      aria-label={t("loading")}
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
  const cacheKey = textPreviewKey({ fileKey, fileUrl });
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
        const text = await requestFileTextPreview({ cacheKey, fileUrl }).catch(
          () => null
        );
        if (active && text !== null) {
          setSource(text);
        }
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
