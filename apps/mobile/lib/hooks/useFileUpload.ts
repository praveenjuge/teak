import { api } from "@teak/convex";
import {
  type FinalizeUploadedCardArgs,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { useMutation } from "convex/react";
import * as FileSystem from "expo-file-system/legacy";

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
    {
      uploadAndCreateCard,
      finalizeUploadedCard,
      uploadBinaryFromUri: async ({ fileUri, uploadUrl, contentType }) => {
        const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
          headers: { "Content-Type": contentType },
          httpMethod: "PUT",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        });

        return {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
        };
      },
    },
    config
  );
}
