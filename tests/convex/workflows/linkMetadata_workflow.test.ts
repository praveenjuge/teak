// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";
import {
    linkMetadataWorkflow,
    startLinkMetadataWorkflow,
    linkMetadataWorkflowHandler,
    startLinkMetadataWorkflowHandler,
    parseLinkMetadataRetryableError
} from "../../../convex/workflows/linkMetadata";
import { workflow } from "../../../convex/workflows/manager";

describe("linkMetadata utils", () => {
    test("parseLinkMetadataRetryableError handles non-Error objects", () => {
        expect(parseLinkMetadataRetryableError("string error")).toBeNull();
        expect(parseLinkMetadataRetryableError({})).toBeNull();
        expect(parseLinkMetadataRetryableError(new Error("Generic"))).toBeNull();
    });

    test("parseLinkMetadataRetryableError handles malformed JSON", () => {
        const error = new Error(`workflow:linkMetadata:retryable:{bad json`);
        const result = parseLinkMetadataRetryableError(error);
        expect(result).toEqual({
            type: "error",
            message: "{bad json"
        });
    });
});

describe("linkMetadataWorkflow", () => {
    test("workflow handler success", async () => {
        const mockStep = {
            runAction: mock().mockResolvedValue({ status: "success", normalizedUrl: "url1" })
        };

        const result = await linkMetadataWorkflowHandler(mockStep, { cardId: "c1" });
        expect(result.success).toBe(true);
    });

    test("workflow handler retryable error", async () => {
        const retryablePayload = { type: "rate_limit", message: "too many", normalizedUrl: "url1" };
        const error = new Error(`workflow:linkMetadata:retryable:${JSON.stringify(retryablePayload)}`);

        const mockStep = {
            runAction: mock().mockRejectedValue(error),
            runMutation: mock().mockResolvedValue(null)
        };

        const result = await linkMetadataWorkflowHandler(mockStep, { cardId: "c1" });
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("rate_limit");
        expect(mockStep.runMutation).toHaveBeenCalled();
    });

    test("workflow handler non-retryable error", async () => {
        const mockStep = {
            runAction: mock().mockRejectedValue(new Error("Fatal"))
        };

        expect(linkMetadataWorkflowHandler(mockStep, { cardId: "c1" })).rejects.toThrow("Fatal");
    });

    test("startLinkMetadataWorkflow", async () => {
        const mockCtx = {};
        const mockWorkflowStart = mock().mockResolvedValue("w1");
        workflow.start = mockWorkflowStart;

        const result = await startLinkMetadataWorkflowHandler(mockCtx, { cardId: "c1" });

        expect(result.workflowId).toBe("w1");
        expect(mockWorkflowStart).toHaveBeenCalled();
    });
});
