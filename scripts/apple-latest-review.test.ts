import { describe, expect, test } from "bun:test";

import {
  applyLatestReviewVersion,
  planLatestReviewVersion,
} from "./apple-latest-review.mjs";

const response = (
  versions: Array<{ id: string; state: string; version: string }>
) => ({
  data: versions.map(({ id, state, version }) => ({
    attributes: { appVersionState: state, versionString: version },
    id,
  })),
});

describe("latest Apple review planning", () => {
  test("cancels and promotes the one older in-flight version", () => {
    expect(
      planLatestReviewVersion(
        response([
          { id: "live", state: "READY_FOR_SALE", version: "1.0.58" },
          { id: "old", state: "WAITING_FOR_REVIEW", version: "1.0.60" },
        ]),
        "1.0.61"
      )
    ).toEqual({
      cancelSuperseded: true,
      promoteSuperseded: true,
      sourceVersion: "1.0.58",
      supersededId: "old",
      supersededState: "WAITING_FOR_REVIEW",
      supersededVersion: "1.0.60",
      targetId: "",
      targetState: "",
    });
  });

  test("cancels an older review without replacing an existing target", () => {
    const plan = planLatestReviewVersion(
      response([
        { id: "old", state: "IN_REVIEW", version: "1.0.60" },
        { id: "target", state: "PREPARE_FOR_SUBMISSION", version: "1.0.61" },
      ]),
      "1.0.61"
    );
    expect(plan.cancelSuperseded).toBe(true);
    expect(plan.promoteSuperseded).toBe(false);
    expect(plan.targetId).toBe("target");
  });

  test("reuses the newest editable version when no review is active", () => {
    const plan = planLatestReviewVersion(
      response([
        { id: "older", state: "DEVELOPER_REJECTED", version: "1.0.59" },
        { id: "newer", state: "READY_FOR_REVIEW", version: "1.0.60" },
      ]),
      "1.0.61"
    );
    expect(plan.cancelSuperseded).toBe(false);
    expect(plan.promoteSuperseded).toBe(true);
    expect(plan.supersededId).toBe("newer");
  });

  test("does not promote a pre-existing developer-rejected version", () => {
    const plan = planLatestReviewVersion(
      response([
        { id: "rejected", state: "DEVELOPER_REJECTED", version: "1.0.60" },
      ]),
      "1.0.61"
    );
    expect(plan.promoteSuperseded).toBe(false);
    expect(plan.supersededId).toBe("");
  });

  test("refuses to resubmit an exact developer-rejected target", async () => {
    let called = false;
    await expect(
      applyLatestReviewVersion({
        appId: "app-id",
        dryRun: false,
        platform: "IOS",
        response: response([
          { id: "old", state: "IN_REVIEW", version: "1.0.60" },
          {
            id: "rejected",
            state: "DEVELOPER_REJECTED",
            version: "1.0.61",
          },
        ]),
        runCommand: () => {
          called = true;
          return {};
        },
        targetVersion: "1.0.61",
      })
    ).rejects.toThrow("Refusing to mutate App Store version");
    expect(called).toBe(false);
  });

  test("does not report a rejected target as a valid dry run", async () => {
    await expect(
      applyLatestReviewVersion({
        appId: "app-id",
        dryRun: true,
        platform: "IOS",
        response: response([
          { id: "old", state: "IN_REVIEW", version: "1.0.60" },
          {
            id: "rejected",
            state: "DEVELOPER_REJECTED",
            version: "1.0.61",
          },
        ]),
        targetVersion: "1.0.61",
      })
    ).rejects.toThrow("Refusing to mutate App Store version");
  });

  test("leaves the requested version alone when it is already in review", () => {
    const plan = planLatestReviewVersion(
      response([
        { id: "target", state: "WAITING_FOR_REVIEW", version: "1.0.61" },
      ]),
      "1.0.61"
    );
    expect(plan.cancelSuperseded).toBe(false);
    expect(plan.promoteSuperseded).toBe(false);
    expect(plan.targetState).toBe("WAITING_FOR_REVIEW");
  });

  test("does not cancel another review when the exact target is active", async () => {
    for (const state of ["WAITING_FOR_REVIEW", "IN_REVIEW"]) {
      let called = false;
      const result = await applyLatestReviewVersion({
        appId: "app-id",
        dryRun: false,
        platform: "IOS",
        response: response([
          { id: "old", state: "IN_REVIEW", version: "1.0.60" },
          { id: "target", state, version: "1.0.61" },
        ]),
        runCommand: () => {
          called = true;
          return {};
        },
        targetVersion: "1.0.61",
      });
      expect(called).toBe(false);
      expect(result).toMatchObject({
        cancelSuperseded: false,
        mutate: false,
        supersededId: "",
        targetState: state,
      });
    }
  });

  test("fails closed for ambiguous or non-latest requests", () => {
    expect(() =>
      planLatestReviewVersion(
        response([
          { id: "one", state: "WAITING_FOR_REVIEW", version: "1.0.59" },
          { id: "two", state: "IN_REVIEW", version: "1.0.60" },
        ]),
        "1.0.61"
      )
    ).toThrow("Multiple older App Store versions");
    expect(() =>
      planLatestReviewVersion(
        response([{ id: "newer", state: "READY_FOR_SALE", version: "1.0.62" }]),
        "1.0.61"
      )
    ).toThrow("newer than requested");
  });

  test("cancels, waits, renames, and verifies before returning mutation state", async () => {
    const commands: string[][] = [];
    let viewCount = 0;
    const result = await applyLatestReviewVersion({
      appId: "app-id",
      dryRun: false,
      platform: "IOS",
      response: response([
        { id: "old", state: "WAITING_FOR_REVIEW", version: "1.0.60" },
      ]),
      runCommand: (command: string[]) => {
        commands.push(command);
        if (command[0] === "submit") {
          return { cancelled: true, id: "submission-id" };
        }
        if (command[1] === "view") {
          viewCount += 1;
          return {
            id: "old",
            state: viewCount === 1 ? "CANCELING" : "DEVELOPER_REJECTED",
            versionString: "1.0.60",
          };
        }
        if (command[1] === "update") {
          return { id: "old", state: "DEVELOPER_REJECTED" };
        }
        return response([
          { id: "old", state: "DEVELOPER_REJECTED", version: "1.0.61" },
        ]);
      },
      targetVersion: "1.0.61",
      waitCommand: () => Promise.resolve(),
    });

    expect(commands[0]).toEqual([
      "submit",
      "cancel",
      "--version-id",
      "old",
      "--app",
      "app-id",
      "--confirm",
    ]);
    expect(commands.some((command) => command[1] === "update")).toBe(true);
    expect(result).toMatchObject({
      mutate: true,
      targetId: "old",
      targetState: "DEVELOPER_REJECTED",
    });
  });

  test("dry runs report replacement without calling App Store Connect", async () => {
    let called = false;
    const result = await applyLatestReviewVersion({
      appId: "app-id",
      dryRun: true,
      platform: "MAC_OS",
      response: response([
        { id: "old", state: "IN_REVIEW", version: "1.0.60" },
      ]),
      runCommand: () => {
        called = true;
        return {};
      },
      targetVersion: "1.0.61",
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({
      cancelSuperseded: true,
      mutate: false,
      promoteSuperseded: true,
    });
  });
});
