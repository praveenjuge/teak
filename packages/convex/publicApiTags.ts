import { apiMutation, apiQuery } from "./ownerOperation";
import { tagOperationOwnerOperations } from "./tag/tagOperations";

export const startTagOperationForUser = apiMutation(
  tagOperationOwnerOperations.start
);
export const getTagOperationForUser = apiQuery(tagOperationOwnerOperations.get);
