import { resolveTextCardInput } from "@teak/convex/shared";
import {
  type CardCreationSource,
  captureEvent,
} from "@teak/convex/shared/analytics";

export interface CreateCardFromTextArgs {
  content: string;
  type?: "link";
  url?: string;
}

export interface CreateCardFromTextDependencies {
  createCard: (args: CreateCardFromTextArgs) => Promise<unknown>;
  source?: Extract<CardCreationSource, "mobile" | "share_intent">;
}

export function createCardFromText(
  content: string,
  dependencies: CreateCardFromTextDependencies
) {
  const resolved = resolveTextCardInput({ content });
  captureEvent("card_create_submitted", {
    card_type: resolved.type,
    source: dependencies.source ?? "mobile",
    via: "text",
  });
  return dependencies.createCard({
    content: resolved.content,
    type: resolved.type === "link" ? "link" : undefined,
    url: resolved.url,
  });
}
