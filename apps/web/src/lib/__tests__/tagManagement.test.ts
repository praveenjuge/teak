import { describe, expect, it } from "bun:test";
import { tagsAfterAdding, tagsAfterRemoving } from "../tagManagement";

describe("grid tag management", () => {
  it("adds to the tags the card has", () => {
    expect(tagsAfterAdding({ tags: ["design", "ui"] }, " Web ")).toEqual([
      "design",
      "ui",
      "web",
    ]);
    expect(tagsAfterAdding({}, "web")).toEqual(["web"]);
  });

  it("writes nothing for a tag it has, a blank tag, or a card it can't see", () => {
    expect(tagsAfterAdding({ tags: ["web"] }, "web")).toBeNull();
    expect(tagsAfterAdding({ tags: ["web"] }, "  ")).toBeNull();
    expect(tagsAfterAdding(null, "web")).toBeNull();
    expect(tagsAfterRemoving(null, "web")).toBeNull();
  });

  it("removes one tag and clears the list when it was the last", () => {
    expect(tagsAfterRemoving({ tags: ["design", "web"] }, "web")).toEqual({
      tags: ["design"],
    });
    expect(tagsAfterRemoving({ tags: ["web"] }, "web")).toEqual({
      tags: undefined,
    });
  });
});
