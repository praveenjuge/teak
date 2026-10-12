// WorkOS resources identify token audiences. Each deployment derives both from
// one resource origin (WORKOS_RESOURCE_ORIGIN); production keeps teakvault.com.
export interface WorkosResources {
  readonly api: string;
  readonly mcp: string;
}

export const PRODUCTION_WORKOS_RESOURCE_ORIGIN = "https://teakvault.com";

// Takes any URL on the resource origin, so clients can pass the discovered MCP
// resource and get its API sibling.
export const workosResourcesFor = (url: string): WorkosResources => {
  const { origin } = new URL(url);
  return Object.freeze({ api: `${origin}/api`, mcp: `${origin}/mcp` });
};

export const PRODUCTION_WORKOS_RESOURCES = workosResourcesFor(
  PRODUCTION_WORKOS_RESOURCE_ORIGIN
);
