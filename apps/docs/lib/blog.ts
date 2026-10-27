/**
 * Blog posts are content pages with `type: blog` under `content/blog`. Blume
 * gives them a feed and BlogPosting structured data; Teak adds the `/blog`
 * index and each post's byline from these helpers.
 */

export interface BlogAuthor {
  name: string;
  url?: string;
}

type AuthorField = string | BlogAuthor | (string | BlogAuthor)[] | undefined;

export interface BlogFrontmatter {
  authors?: AuthorField;
  date: string | Date;
  description?: string;
  draft?: boolean;
  title: string;
  type: "blog";
}

export const isBlogPost = (data: {
  date?: unknown;
  draft?: unknown;
  type?: unknown;
}): data is BlogFrontmatter =>
  data.type === "blog" && Boolean(data.date) && data.draft !== true;

/** Frontmatter `authors` as a list, whether it names one author or several. */
export const blogAuthors = (authors: AuthorField): BlogAuthor[] => {
  if (!authors) {
    return [];
  }
  return (Array.isArray(authors) ? authors : [authors]).map((author) =>
    typeof author === "string" ? { name: author } : author
  );
};

/** "October 27, 2026", read in UTC so a YAML date never shifts a day. */
export const formatPostDate = (date: string | Date) =>
  new Date(date).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });

/** A post's slug: the file name, which is also its cover's name in `images/`. */
export const postSlug = (href: string) =>
  href.split("/").filter(Boolean).at(-1);

/** Newest first; posts on the same day keep their title order. */
export const sortPosts = <T extends { date: string | Date; title: string }>(
  posts: T[]
) =>
  posts.toSorted(
    (a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime() ||
      a.title.localeCompare(b.title)
  );
