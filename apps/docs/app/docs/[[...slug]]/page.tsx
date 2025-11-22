import type { ComponentType } from "react";
import { createRelativeLink } from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  // MDX v14 types don't expose compiled body/toc on PageData, but they are present at runtime.
  const data = page.data as typeof page.data & {
    body: ComponentType;
    toc?: unknown;
    title?: string;
    description?: string;
  };
  const MDXContent = data.body;

  return (
    <DocsPage
      toc={data.toc}
      tableOfContent={{
        style: "clerk",
      }}
    >
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
    keywords: `teak, ${page.data.title.toLowerCase()}, personal knowledge management, setup guide`,
    authors: [{ name: "Teak Team" }],
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      type: "article",
      siteName: "Teak",
    },
    twitter: {
      card: "summary",
      title: page.data.title,
      description: page.data.description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
