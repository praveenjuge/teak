import { resolveTextCardInput } from "@teak/convex/shared";
import { runClientSpan } from "@teak/convex/shared/client-telemetry";
import {
  type CardCreationSource,
  trackCardCreateAttempt,
} from "@teak/convex/shared/metrics";

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
  const source = dependencies.source ?? "mobile";
  trackCardCreateAttempt({ cardType: resolved.type, source, via: "text" });
  return runClientSpan(
    {
      attributes: { "card.type": resolved.type, source },
      name: "mobile.card.save",
      operation: "teak.workflow",
      stage: "creation",
    },
    () =>
      dependencies.createCard({
        content: resolved.content,
        type: resolved.type === "link" ? "link" : undefined,
        url: resolved.url,
      })
  );
}
