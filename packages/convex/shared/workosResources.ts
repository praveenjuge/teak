export interface WorkosResources {
  readonly api: string;
  readonly mcp: string;
}

export const PRODUCTION_WORKOS_RESOURCE_ORIGIN = "https://teakvault.com";

export const workosResourcesFor = (url: string): WorkosResources => {
  const { origin } = new URL(url);
  return Object.freeze({ api: `${origin}/api`, mcp: `${origin}/mcp` });
};

export const PRODUCTION_WORKOS_RESOURCES = workosResourcesFor(
  PRODUCTION_WORKOS_RESOURCE_ORIGIN
);
