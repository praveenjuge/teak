import { changelog, docs } from "fumadocs-mdx:collections/server";
import { loader } from "fumadocs-core/source";
import {
  BookOpen,
  Bot,
  Braces,
  Command,
  LifeBuoy,
  Monitor,
  Puzzle,
  ScrollText,
  Server,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Wrench,
} from "lucide-react";

const iconMap = {
  Bot,
  BookOpen,
  Braces,
  Command,
  LifeBuoy,
  Monitor,
  Puzzle,
  ScrollText,
  Server,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Wrench,
};

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon: (iconName) => {
    const Icon = iconMap[iconName as keyof typeof iconMap];
    if (Icon) {
      return <Icon className="size-4" />;
    }
    return null;
  },
});

export const changelogCollection = changelog;

export const getSortedChangelogEntries = () => {
  return [...changelogCollection].sort((entryA, entryB) => {
    return new Date(entryB.date).getTime() - new Date(entryA.date).getTime();
  });
};
