import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import {
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  type FinalizeUploadedCardArgs,
  useFileUploadCore,
  setFileUploadSentryCaptureFunction,
} from "@teak/convex/shared/hooks/useFileUpload";
import { type Id } from "@teak/convex/_generated/dataModel";
import * as Sentry from "@sentry/nextjs";

// Inject Sentry capture function into shared hook
setFileUploadSentryCaptureFunction((error, context) => {
  Sentry.captureException(error, context);
});

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
