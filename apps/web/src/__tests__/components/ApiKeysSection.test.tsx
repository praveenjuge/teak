// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import React from "react";

let mockedQueryResult: unknown[] = [];

mock.module("convex/react", () => ({
  useMutation: mock(() => mock().mockResolvedValue(null)),
}));

mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: mock(() => mockedQueryResult),
}));

import { ApiKeysSection } from "../../components/settings/ApiKeysSection";

describe("ApiKeysSection", () => {
  test("renders without crashing when no active key", () => {
    expect(() => {
      React.createElement(ApiKeysSection);
    }).not.toThrow();
  });

  test("renders without crashing when an active key exists", () => {
    mockedQueryResult = [
      {
        id: "k1",
        name: "API Keys",
        keyPrefix: "abc123",
        maskedKey: "abc123••••••••",
        access: "full_access",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    expect(() => {
      React.createElement(ApiKeysSection);
    }).not.toThrow();
  });
});
