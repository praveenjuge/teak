interface PortalWindowLike {
  closed?: boolean;
}

interface OpenCustomerPortalOptions {
  createCustomerPortal: () => Promise<string>;
  openWindow: (
    url: string,
    target: string,
    features: string
  ) => PortalWindowLike | null;
}

export async function openCustomerPortal({
  createCustomerPortal,
  openWindow,
}: OpenCustomerPortalOptions) {
  const portalUrl = await createCustomerPortal();
  const portalWindow = openWindow(portalUrl, "_blank", "noopener,noreferrer");

  if (!portalWindow) {
    throw new Error("Could not open portal");
  }
}

export type { OpenCustomerPortalOptions, PortalWindowLike };
