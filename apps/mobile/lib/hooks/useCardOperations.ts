import { api } from "@teak/convex";
import { useMutation } from "convex/react";

export const useCreateCard = () => useMutation(api.cards.createCard);
export const useUpdateCard = () => useMutation(api.cards.updateCardField);
export const usePermanentDeleteCard = () =>
  useMutation(api.cards.permanentDeleteCard);
