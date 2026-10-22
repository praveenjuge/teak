import type { DevScenarioCardDef } from "../card/defaultCards";

export const link = (
  url: string,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "link",
  content: url,
  url,
  runProcessing: true,
  ...extra,
});

export const palette = (
  content: string,
  hexes: string[],
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => ({
  type: "palette",
  content,
  colors: hexes.map((hex) => ({ hex })),
  ...extra,
});

export const SCENARIO_MARKER = "teak-scenario";

export const bylineLink = (
  slug: string,
  url: string,
  linkPreview: Record<string, unknown>,
  extra: Partial<DevScenarioCardDef> = {}
): DevScenarioCardDef => {
  const markedUrl = `${url}#${SCENARIO_MARKER}-card-details-${slug}`;
  return {
    type: "link",
    content: markedUrl,
    url: markedUrl,
    tags: ["scenario-card-details"],
    metadataTitle:
      typeof linkPreview.title === "string" ? linkPreview.title : undefined,
    metadata: {
      linkPreview: {
        source: "scenario",
        status: "success",
        fetchedAt: Date.UTC(2026, 9, 1),
        url: markedUrl,
        finalUrl: markedUrl,
        ...linkPreview,
      } as never,
    },
    ...extra,
  };
};
