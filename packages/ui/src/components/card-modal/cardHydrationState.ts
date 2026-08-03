interface InvalidHydratedCardState<HydratedCard> {
  cardId: string | null;
  hasCardData: boolean;
  hydratedCard: HydratedCard | null | undefined;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  open: boolean;
}

export function shouldReportInvalidHydratedCard<HydratedCard>({
  cardId,
  hasCardData,
  hydratedCard,
  isAuthenticated,
  isAuthLoading,
  open,
}: InvalidHydratedCardState<HydratedCard>) {
  return Boolean(
    open &&
      cardId &&
      !hasCardData &&
      !isAuthLoading &&
      isAuthenticated &&
      hydratedCard === null
  );
}
