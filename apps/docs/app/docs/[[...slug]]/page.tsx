import { createRelativeLink } from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import { JsonLd, organizationSchema, SITE_URL } from "@/components/JsonLd";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

function generateBreadcrumbSchema(slug: string[] | undefined, title: string) {
  const items = [
    {
      "@type": "ListItem" as const,
      position: 1,
      name: "Home",
      item: SITE_URL,
    },
    {
      "@type": "ListItem" as const,
      position: 2,
      name: "Docs",
      item: `${SITE_URL}/docs`,
    },
  ];

  if (slug && slug.length > 0) {
    // Add intermediate segments
    slug.forEach((segment, index) => {
      const isLast = index === slug.length - 1;
      items.push({
        "@type": "ListItem" as const,
        position: items.length + 1,
        name: isLast
          ? title
          : segment.charAt(0).toUpperCase() +
            segment.slice(1).replace(/-/g, " "),
        item: `${SITE_URL}/docs/${slug.slice(0, index + 1).join("/")}`,
      });
    });
  }

  return {
    "@context": "https://schema.org" as const,
    "@type": "BreadcrumbList" as const,
    itemListElement: items,
  };
}

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

  const pageUrl = params.slug
    ? `${SITE_URL}/docs/${params.slug.join("/")}`
    : `${SITE_URL}/docs`;

  const articleSchema = {
    "@context": "https://schema.org" as const,
    "@type": "Article" as const,
    "@id": `${pageUrl}/#article`,
    headline: data.title,
    description: data.description,
    url: pageUrl,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    image: `${SITE_URL}/hero-image.png`,
    mainEntityOfPage: {
      "@type": "WebPage" as const,
      "@id": pageUrl,
    },
  };

  const breadcrumbSchema = generateBreadcrumbSchema(
    params.slug,
    data.title || ""
  );

  return (
    <>
      <JsonLd schema={[organizationSchema, articleSchema, breadcrumbSchema]} />
      <DocsPage
        tableOfContent={{
          style: "clerk",
        }}
        toc={data.toc}
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
    </>
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
      locale: "en_US",
      images: [
        {
          url: "/hero-image.png",
          width: 1200,
          height: 630,
          alt: `Teak - ${page.data.title}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: ["/hero-image.png"],
    },
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: params.slug
        ? `https://teakvault.com/docs/${params.slug.join("/")}`
        : "https://teakvault.com/docs",
    },
  };
}
