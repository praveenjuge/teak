"use node";

import { Agent } from "undici";
import type { PinnedFetch } from "../../linkMetadata/ssrf";

export const pinnedFetch: PinnedFetch = (url, validatedAddresses, init) => {
  const addresses = validatedAddresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const first = addresses[0];
        if (!first) {
          callback(new Error("Validated address set is empty"), "", 0);
          return;
        }
        callback(null, first.address, first.family);
      },
    },
    keepAliveMaxTimeout: 1,
    keepAliveTimeout: 1,
  });

  return fetch(url, { ...init, dispatcher } as RequestInit);
};
