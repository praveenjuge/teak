import { api } from "@teak/convex";
import {
  type FinalizeUploadedCardArgs,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { useMutation } from "convex/react";

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
    finalizeUploadedCardMutation(args);

  return useFileUploadCore(
    { uploadAndCreateCard, finalizeUploadedCard },
    config
  );
}
