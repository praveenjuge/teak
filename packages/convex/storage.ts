import { internalAction } from "./_generated/server";
import { syncStorageMetadata } from "./fileStorage";
import { storageRefValidator } from "./storageRefs";

export const syncUploadedStorageMetadata = internalAction({
  args: {
    fileRef: storageRefValidator,
  },
  returns: undefined,
  handler: async (ctx, { fileRef }) => {
    await syncStorageMetadata(ctx, fileRef);
  },
});
