interface PortalWindowLike {
  closed?: boolean;
}

interface OpenCustomerPortalOptions {
  createCustomerPortal: () => Promise<string>;
  openPortal?: (url: string) => Promise<unknown> | unknown;
  openWindow?: (
    url: string,
    target: string,
    features: string
  ) => PortalWindowLike | null;
}

export async function openCustomerPortal({
  createCustomerPortal,
  openPortal,
  openWindow,
}: OpenCustomerPortalOptions) {
  const portalUrl = await createCustomerPortal();
  if (openPortal) {
    await openPortal(portalUrl);
    return;
  }

  openWindow?.(portalUrl, "_blank", "noopener,noreferrer");
}

export type { OpenCustomerPortalOptions, PortalWindowLike };

export async function triggerCustomerPortal(
  onCreatePortal: () => Promise<void>
) {
  await onCreatePortal();
}
