import type { MetadataRoute } from "next";
import { authors } from "@/lib/authors";
import { source } from "@/lib/source";

export const dynamic = "force-static";

const SITE_URL = "https://teakvault.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const currentDate = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/apps`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/changelog`,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/authors`,
      lastModified: currentDate,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  // Docs pages from fumadocs source
  const docsPages: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${SITE_URL}${page.url}`,
    lastModified: currentDate,
    changeFrequency: "weekly" as const,
    priority: page.url === "/docs" ? 0.9 : 0.7,
  }));

  // Author pages
  const authorPages: MetadataRoute.Sitemap = Object.keys(authors).map(
    (authorId) => ({
      url: `${SITE_URL}/authors/${authorId}`,
      lastModified: currentDate,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })
  );

  return [...staticPages, ...docsPages, ...authorPages];
}
