import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  type FinalizeUploadedCardArgs,
  setFileUploadSentryCaptureFunction,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { useMutation } from "convex/react";

export type FileUploadErrorCaptureFunction = (
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
) => void;

const noopCapture: FileUploadErrorCaptureFunction = () => {};

export function configureFileUploadErrorCapture(
  capture?: FileUploadErrorCaptureFunction
) {
  setFileUploadSentryCaptureFunction(capture ?? noopCapture);
}

export function useFileUpload(config: UnifiedFileUploadConfig = {}) {
  const uploadAndCreateCardMutation = useMutation(
    api.cards.uploadAndCreateCard
  );
  const finalizeUploadedCardMutation = useMutation(
    api.cards.finalizeUploadedCard
  );

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardMutation({
      ...args,
      fileId: args.fileId as Id<"_storage">,
    });

  return useFileUploadCore(
    { uploadAndCreateCard, finalizeUploadedCard },
    config
  );
}
