import { api } from "@teak/convex";
import {
  type FinalizeUploadedCardArgs,
  type UnifiedFileUploadConfig,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { useMutation } from "convex/react";
import * as FileSystem from "expo-file-system/legacy";

const createUploadAbortError = () => {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

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
      uploadBinaryFromUri: async ({
        fileUri,
        uploadUrl,
        contentType,
        signal,
      }) => {
        const uploadTask = FileSystem.createUploadTask(uploadUrl, fileUri, {
          headers: { "Content-Type": contentType },
          httpMethod: "PUT",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        });
        const cancelUpload = () => {
          void uploadTask.cancelAsync().catch(() => {
            // The shared hook suppresses callbacks once the signal is aborted.
          });
        };

        if (signal.aborted) {
          await uploadTask.cancelAsync();
          throw createUploadAbortError();
        }

        signal.addEventListener("abort", cancelUpload, { once: true });

        let result: FileSystem.FileSystemUploadResult | null | undefined;
        try {
          result = await uploadTask.uploadAsync();
        } catch (error) {
          if (signal.aborted) {
            throw createUploadAbortError();
          }
          throw error;
        } finally {
          signal.removeEventListener("abort", cancelUpload);
        }

        if (signal.aborted) {
          throw createUploadAbortError();
        }

        return {
          ok: result ? result.status >= 200 && result.status < 300 : false,
          status: result?.status ?? 0,
        };
      },
    },
    config
  );
}
