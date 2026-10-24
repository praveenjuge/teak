import { api } from "@teak/convex";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import { useMemo } from "react";
import {
  type FinalizeUploadedCardArgs,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "./useFileUploadCore";

export function useFileUpload(config: UnifiedFileUploadConfig = {}) {
  const upload = useTranslations("hooks.upload");
  const errors = useTranslations("errors");
  const translators = useMemo(() => ({ errors, upload }), [errors, upload]);
  const uploadAndCreateCardMutation = useMutation(
    api.cards.uploadAndCreateCard
  );
  const finalizeUploadedCardAction = useAction(api.cards.finalizeUploadedCard);
  const prepareMultipartUpload = useAction(
    api.fileUploads.prepareMultipartUpload
  );
  const completeMultipartUpload = useAction(
    api.fileUploads.completeMultipartUpload
  );
  const recordMultipartPart = useMutation(api.fileUploads.recordMultipartPart);

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardAction({ ...args, source: "web" });

  return useFileUploadCore(
    {
      completeMultipartUpload,
      finalizeUploadedCard,
      prepareMultipartUpload,
      recordMultipartPart,
      uploadAndCreateCard,
    },
    config,
    translators
  );
}
