// @ts-nocheck
import { describe, expect, test } from "bun:test";

describe("export module wiring", () => {
  test("export.ts exposes the public + internal surface", async () => {
    const mod = await import("../../dataExport");
    // Public functions
    expect(mod.getLatestExport).toBeDefined();
    expect(mod.startExport).toBeDefined();
    expect(mod.cancelExport).toBeDefined();
    expect(mod.getExportDownloadUrl).toBeDefined();
    // Internal functions used by the workflow / cleanup
    expect(mod.getJob).toBeDefined();
    expect(mod.markRunning).toBeDefined();
    expect(mod.recordSnapshotPage).toBeDefined();
    expect(mod.getExportCardsPage).toBeDefined();
    expect(mod.completeExport).toBeDefined();
    expect(mod.failExport).toBeDefined();
    expect(mod.isCancelRequested).toBeDefined();
    expect(mod.findExpiredReadyJobs).toBeDefined();
    expect(mod.expireJob).toBeDefined();
    expect(mod.deleteJobItemsPage).toBeDefined();
  });

  test("workflow modules export workflow + starter", async () => {
    const wf = await import("../../workflows/export");
    expect(wf.exportWorkflow).toBeDefined();
    expect(wf.startExportWorkflow).toBeDefined();

    const cleanup = await import("../../workflows/exportCleanup");
    expect(cleanup.exportCleanupWorkflow).toBeDefined();
    expect(cleanup.startExportCleanupWorkflow).toBeDefined();
  });

  test("node action module exports archive + delete actions", async () => {
    const node = await import("../../export/runExport");
    expect(node.runExportArchive).toBeDefined();
    expect(node.deleteArtifact).toBeDefined();
  });

  test("crons module registers the export cleanup job", async () => {
    const crons = await import("../../crons");
    expect(crons.default).toBeDefined();
  });
});

describe("schema export tables", () => {
  test("schema exports export validators and default schema", async () => {
    const schema = await import("../../schema");
    expect(schema.exportJobValidator).toBeDefined();
    expect(schema.exportJobItemValidator).toBeDefined();
    expect(schema.exportStatusValidator).toBeDefined();
    expect(schema.default).toBeDefined();
  });
});
