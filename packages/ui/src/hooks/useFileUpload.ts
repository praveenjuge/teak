import { api } from "@teak/convex";
import {
  type FinalizeUploadedCardArgs,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { useAction, useMutation } from "convex/react";

export function useFileUpload(config: UnifiedFileUploadConfig = {}) {
  const uploadAndCreateCardMutation = useMutation(
    api.cards.uploadAndCreateCard
  );
  const finalizeUploadedCardAction = useAction(api.cards.finalizeUploadedCard);

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardAction(args);

  return useFileUploadCore(
    { uploadAndCreateCard, finalizeUploadedCard },
    config
  );
}
