// @ts-nocheck
import { expect, mock, test } from "bun:test";
import {
  completeConversion,
  recordFailure,
  resumeOne,
  retryConversion,
  untrackedCandidatePage,
} from "../markdownDocumentMigration";
import {
  classifyStorageError,
  processAuditHandler,
} from "../markdownDocumentMigrationAction";
import { buildR2UserPrefix } from "../storage/r2";

const handlerOf = (fn: any) => fn.handler ?? fn;

function fixture(isDeleted?: boolean) {
  const sourceFileKey = `${buildR2UserPrefix("user-1")}/legacy/note.md`;
  const audit = {
    _id: "audit-1",
    cardId: "card-1",
    userId: "user-1",
    sourceFileKey,
    sourceUpdatedAt: 200,
    sourceEtag: '"etag-1"',
    status: "in_progress",
    attempts: 1,
    retryable: true,
    createdAt: 100,
    updatedAt: 150,
  };
  const card = {
    _id: "card-1",
    userId: "user-1",
    type: "document",
    content: "legacy placeholder",
    fileKey: sourceFileKey,
    thumbnailKey: "thumbnail-key",
    fileMetadata: {
      fileName: "Note.MARKDOWN",
      fileSize: 24,
      mimeType: "text/markdown",
    },
    tags: ["keep"],
    notes: "keep",
    isFavorited: true,
    isDeleted,
    deletedAt: isDeleted ? 175 : undefined,
    aiSummary: "keep",
    aiTranscript: "keep",
    processingStatus: { metadata: { status: "completed" } },
    createdAt: 50,
    updatedAt: 200,
  };
  return { audit, card, sourceFileKey };
}

for (const isDeleted of [undefined, true]) {
  test(`converts ${isDeleted ? "trashed" : "active"} cards while preserving every unrelated field`, async () => {
    const { audit, card } = fixture(isDeleted);
    const patches: [string, Record<string, unknown>][] = [];
    const ctx = {
      db: {
        get: mock(async (id) => (id === audit._id ? audit : card)),
        patch: mock(async (id, value) => patches.push([id, value])),
      },
    } as any;
    const content = "\uFEFF  # Heading\r\n\rBody  ";
    const bytes = new TextEncoder().encode(content);
    const result = await handlerOf(completeConversion)(ctx, {
      auditId: audit._id,
      content,
      sourceByteSize: bytes.byteLength,
      sourceChecksum: "checksum",
      sourceEtag: '"etag-1"',
      verifiedEtag: '"etag-1"',
      claimedAt: audit.updatedAt,
      expectedAttempt: audit.attempts,
    });
    expect(result).toEqual({ converted: true });
    expect(patches[0]).toEqual([card._id, { type: "text", content }]);
    expect(card).toMatchObject({
      fileKey: audit.sourceFileKey,
      thumbnailKey: "thumbnail-key",
      tags: ["keep"],
      notes: "keep",
      isFavorited: true,
      isDeleted,
      aiSummary: "keep",
      aiTranscript: "keep",
      createdAt: 50,
      updatedAt: 200,
    });
    expect(patches[1]?.[1]).toMatchObject({
      status: "converted",
      retryable: false,
      sourceChecksum: "checksum",
      sourceByteSize: bytes.byteLength,
    });
  });
}

test("skips concurrent card or object changes without patching the card", async () => {
  const { audit, card } = fixture();
  card.updatedAt += 1;
  const patch = mock();
  const result = await handlerOf(completeConversion)(
    {
      db: {
        get: mock(async (id) => (id === audit._id ? audit : card)),
        patch,
      },
    },
    {
      auditId: audit._id,
      content: "# changed",
      sourceByteSize: 9,
      sourceChecksum: "checksum",
      sourceEtag: '"etag-2"',
      verifiedEtag: '"etag-2"',
      claimedAt: audit.updatedAt,
      expectedAttempt: audit.attempts,
    }
  );
  expect(result).toEqual({
    converted: false,
    failureReason: "concurrently_changed",
  });
  expect(patch).not.toHaveBeenCalled();
});

test("persists transient retry state and schedules mutation-controlled backoff", async () => {
  const { audit } = fixture();
  const patch = mock();
  const runAfter = mock();
  const result = await handlerOf(recordFailure)(
    {
      db: { get: mock().mockResolvedValue(audit), patch },
      scheduler: { runAfter },
    },
    {
      auditId: audit._id,
      failureReason: "storage_unavailable",
      retryable: true,
      claimedAt: audit.updatedAt,
      expectedAttempt: audit.attempts,
    }
  );
  expect(result).toEqual({ retryScheduled: true });
  expect(patch.mock.calls[0]?.[1]).toMatchObject({
    status: "pending",
    retryable: true,
    failureReason: "storage_unavailable",
  });
  expect(runAfter).toHaveBeenCalledTimes(1);
});

test("targeted retry is idempotent for converted rows", async () => {
  const { audit } = fixture();
  audit.status = "converted";
  const patch = mock();
  expect(
    await handlerOf(retryConversion)(
      { db: { get: mock().mockResolvedValue(audit), patch } },
      { auditId: audit._id }
    )
  ).toEqual({ scheduled: false });
  expect(patch).not.toHaveBeenCalled();
});

test("does not duplicate an in-progress claim", async () => {
  const { audit } = fixture();
  const patch = mock();
  const runAfter = mock();
  expect(
    await handlerOf(resumeOne)(
      {
        db: { get: mock().mockResolvedValue(audit), patch },
        scheduler: { runAfter },
      },
      { auditId: audit._id }
    )
  ).toEqual({ scheduled: false });
  expect(patch).not.toHaveBeenCalled();
  expect(runAfter).not.toHaveBeenCalled();
});

test("reports eligible document cards missing an audit row", async () => {
  const { card } = fixture();
  const paginate = mock().mockResolvedValue({
    continueCursor: "",
    isDone: true,
    page: [
      card,
      { ...card, _id: "card-pdf", fileMetadata: { fileName: "a.pdf" } },
    ],
  });
  const query = mock((table) =>
    table === "cards"
      ? { withIndex: () => ({ paginate }) }
      : { withIndex: () => ({ unique: mock().mockResolvedValue(null) }) }
  );

  const result = await handlerOf(untrackedCandidatePage)(
    { db: { query } },
    { cursor: null, limit: 20 }
  );
  expect(result.page).toEqual([{ cardId: card._id, userId: card.userId }]);
});

test("classifies missing, precondition, and transient storage failures", () => {
  expect(classifyStorageError({ $metadata: { httpStatusCode: 404 } })).toEqual({
    reason: "missing_object",
    retryable: false,
  });
  expect(classifyStorageError({ name: "PreconditionFailed" })).toEqual({
    reason: "concurrently_changed",
    retryable: false,
  });
  expect(classifyStorageError(new Error("timeout"))).toEqual({
    reason: "storage_unavailable",
    retryable: true,
  });
});

async function runStorageScenario(
  send: ReturnType<typeof mock>,
  overrides: Record<string, unknown> = {}
) {
  const { audit } = fixture();
  Object.assign(audit, overrides);
  const mutations: Record<string, unknown>[] = [];
  await processAuditHandler(
    {
      runMutation: mock((_fn, args) => {
        mutations.push(args);
        return args.content === undefined ? null : { converted: true };
      }),
      runQuery: mock(async () => audit),
    },
    { auditId: audit._id, claimedAt: audit.updatedAt },
    { bucket: "test", client: { send } }
  );
  return mutations;
}

test("ignores an action from an older claim", async () => {
  const { audit } = fixture();
  const send = mock();
  const runMutation = mock();
  await processAuditHandler(
    {
      runMutation,
      runQuery: mock().mockResolvedValue(audit),
    },
    { auditId: audit._id, claimedAt: audit.updatedAt - 1 },
    { bucket: "test", client: { send } }
  );
  expect(send).not.toHaveBeenCalled();
  expect(runMutation).not.toHaveBeenCalled();
});

test("persists missing, oversized, invalid UTF-8, and ownership failures", async () => {
  const missing = await runStorageScenario(
    mock(() => {
      throw Object.assign(new Error("missing"), {
        $metadata: { httpStatusCode: 404 },
      });
    })
  );
  expect(missing[0]).toMatchObject({
    failureReason: "missing_object",
    retryable: false,
  });

  const oversized = await runStorageScenario(
    mock(async () => ({
      ContentLength: 512 * 1024 + 1,
      ETag: '"large"',
    }))
  );
  expect(oversized[0]).toMatchObject({
    failureReason: "content_too_large",
    retryable: false,
    sourceByteSize: 512 * 1024 + 1,
  });

  const invalidBytes = new Uint8Array([0xc3, 0x28]);
  const invalid = await runStorageScenario(
    mock(async (command) =>
      command.constructor.name === "HeadObjectCommand"
        ? { ContentLength: invalidBytes.byteLength, ETag: '"etag-1"' }
        : {
            Body: { transformToByteArray: async () => invalidBytes },
            ETag: '"etag-1"',
          }
    )
  );
  expect(invalid[0]).toMatchObject({
    failureReason: "invalid_utf8",
    retryable: false,
  });

  const send = mock();
  const ownership = await runStorageScenario(send, {
    sourceFileKey: "users/another-user/file/note.md",
  });
  expect(ownership[0]).toMatchObject({
    failureReason: "ownership_invalid",
    retryable: false,
  });
  expect(send).not.toHaveBeenCalled();
});

test("detects object changes after decoding and never completes the card patch", async () => {
  const bytes = new TextEncoder().encode("# unchanged");
  let call = 0;
  const mutations = await runStorageScenario(
    mock(() => {
      call += 1;
      if (call === 1) {
        return { ContentLength: bytes.byteLength, ETag: '"etag-1"' };
      }
      if (call === 2) {
        return {
          Body: { transformToByteArray: async () => bytes },
          ETag: '"etag-1"',
        };
      }
      return { ContentLength: bytes.byteLength, ETag: '"etag-2"' };
    })
  );
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({
    failureReason: "concurrently_changed",
    retryable: false,
  });
});

test("passes exact decoded source and checksum to guarded completion", async () => {
  const content = "\uFEFF  # Migrated\r\n\r\nBody  ";
  const bytes = new TextEncoder().encode(content);
  let call = 0;
  const mutations = await runStorageScenario(
    mock(() => {
      call += 1;
      return call === 2
        ? {
            Body: { transformToByteArray: async () => bytes },
            ETag: '"etag-1"',
          }
        : { ContentLength: bytes.byteLength, ETag: '"etag-1"' };
    })
  );
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({
    content,
    sourceByteSize: bytes.byteLength,
    sourceEtag: '"etag-1"',
    verifiedEtag: '"etag-1"',
  });
  expect(mutations[0]?.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
});
