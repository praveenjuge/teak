"use node";

import { Agent } from "undici";
import type { PinnedFetch } from "../../linkMetadata/ssrf";

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export const orderPinnedAddresses = (
  validatedAddresses: string[]
): PinnedAddress[] =>
  validatedAddresses
    .map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }))
    .sort((left, right) => left.family - right.family);

const addressForFamily = (
  addresses: PinnedAddress[],
  family: number | undefined
) =>
  family === 4 || family === 6
    ? addresses.find((address) => address.family === family)
    : addresses[0];

export const pinnedFetch: PinnedFetch = async (
  url,
  validatedAddresses,
  init
) => {
  const addresses = orderPinnedAddresses(validatedAddresses);
  const dispatcher = new Agent({
    connect: {
      autoSelectFamily:
        addresses.some((address) => address.family === 4) &&
        addresses.some((address) => address.family === 6),
      autoSelectFamilyAttemptTimeout: 250,
      lookup(_hostname, options, callback) {
        const family = typeof options.family === "number" ? options.family : 0;
        const compatibleAddresses = family
          ? addresses.filter((address) => address.family === family)
          : addresses;
        if (options.all) {
          callback(null, compatibleAddresses);
          return;
        }
        const selected = addressForFamily(addresses, family);
        if (!selected) {
          callback(new Error("Validated address set is empty"), "", 0);
          return;
        }
        callback(null, selected.address, selected.family);
      },
    },
    keepAliveMaxTimeout: 1,
    keepAliveTimeout: 1,
  });
  const closeDispatcher = () => {
    const close = (dispatcher as Agent & { close?: () => Promise<void> }).close;
    return typeof close === "function"
      ? close.call(dispatcher)
      : Promise.resolve();
  };

  try {
    const response = await fetch(url, { ...init, dispatcher } as RequestInit);
    // close() is graceful: it stops new work immediately and resolves after
    // the response body has finished, so callers can still stream the body.
    void closeDispatcher().catch(() => undefined);
    return response;
  } catch (error) {
    await closeDispatcher();
    throw error;
  }
};
