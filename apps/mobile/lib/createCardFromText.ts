import { resolveTextCardInput } from "@teak/convex/shared";

export interface CreateCardFromTextArgs {
  content: string;
  type?: "link";
  url?: string;
}

export interface CreateCardFromTextDependencies {
  createCard: (args: CreateCardFromTextArgs) => Promise<unknown>;
}

export function createCardFromText(
  content: string,
  dependencies: CreateCardFromTextDependencies
) {
  const resolved = resolveTextCardInput({ content });
  return dependencies.createCard({
    content: resolved.content,
    type: resolved.type === "link" ? "link" : undefined,
    url: resolved.url,
  });
}
