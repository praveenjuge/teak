import { describe, expect, test } from "bun:test";
import { orderPinnedAddresses } from "../../../../convex/workflows/steps/pinnedFetch";

describe("pinnedFetch", () => {
  test("prefers validated IPv4 addresses before IPv6 fallbacks", () => {
    expect(
      orderPinnedAddresses([
        "2606:2800:220:1:248:1893:25c8:1946",
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1947",
        "93.184.216.35",
      ])
    ).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      { address: "2606:2800:220:1:248:1893:25c8:1947", family: 6 },
    ]);
  });
});
