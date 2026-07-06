import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

const toRouteSlug = (id: string) =>
  id === "docs" ? "index" : id.replace(/^docs\//, "").replace(/\/index$/, "");

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection(
    "docs",
    (entry: CollectionEntry<"docs">) => !entry.data.draft
  );
  return docs.map((entry: CollectionEntry<"docs">) => ({
    params: { slug: toRouteSlug(entry.id) },
    props: { body: entry.body },
  }));
};

export const GET: APIRoute<{ body: string }> = ({ props }) =>
  new Response(props.body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
