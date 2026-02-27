import type * as ExpoHaptics from "expo-haptics";

type HapticsApi = Pick<
  typeof ExpoHaptics,
  | "ImpactFeedbackStyle"
  | "NotificationFeedbackType"
  | "impactAsync"
  | "notificationAsync"
>;

async function resolveHapticsApi() {
  if (process.env.EXPO_OS !== "ios") {
    return null;
  }

  const module = await import("expo-haptics");
  return module satisfies HapticsApi;
}

async function runHaptic(
  action: (api: HapticsApi) => Promise<void>,
  api?: HapticsApi
) {
  if (process.env.EXPO_OS !== "ios") {
    return;
  }

  const resolvedApi = api ?? (await resolveHapticsApi());

  if (!resolvedApi) {
    return;
  }

  try {
    await action(resolvedApi);
  } catch {
    // Haptics are best-effort and should never block core flows.
  }
}

export function triggerCardTapHaptic(api?: HapticsApi) {
  return runHaptic(
    (currentApi) =>
      currentApi.impactAsync(currentApi.ImpactFeedbackStyle.Light),
    api
  );
}

export function triggerSuccessHaptic(api?: HapticsApi) {
  return runHaptic(
    (currentApi) =>
      currentApi.notificationAsync(currentApi.NotificationFeedbackType.Success),
    api
  );
}

export function triggerValidationErrorHaptic(api?: HapticsApi) {
  return runHaptic(
    (currentApi) =>
      currentApi.notificationAsync(currentApi.NotificationFeedbackType.Error),
    api
  );
}
