import type { useCardModal } from "@/hooks/useCardModal";

export type UseCardModalReturn = ReturnType<typeof useCardModal>;
export type CardModalCard = NonNullable<UseCardModalReturn["card"]>;
export type GetCurrentValue = UseCardModalReturn["getCurrentValue"];
