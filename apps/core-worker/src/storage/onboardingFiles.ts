import {
  FILES_ONBOARDING_ASSET_PATH,
  FILES_ONBOARDING_MAX_FILES,
  type FilesOnboardingCardResult,
  type FilesOnboardingFile,
  type FilesStoreOnboardingFilesParams,
  type FilesStoreOnboardingFilesResult,
  isOnboardingSourceName,
} from "@teak/files-protocol";
import { isValidUploadKey } from "./upload";

export interface OnboardingFilesEnv {
  ASSETS?: Fetcher;
  BUCKET: R2Bucket;
}

const MAX_CONTENT_TYPE_LENGTH = 255;
// Only the pathname picks the asset; the host is never contacted.
const ASSET_ORIGIN = "https://assets.local";

const parseFile = (value: unknown): FilesOnboardingFile => {
  const { contentType, key, source } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof contentType !== "string" ||
    contentType.length === 0 ||
    contentType.length > MAX_CONTENT_TYPE_LENGTH ||
    typeof key !== "string" ||
    !isValidUploadKey(key) ||
    !isOnboardingSourceName(source)
  ) {
    throw new Error("invalid_onboarding_file");
  }
  return { contentType, key, source };
};

export const parseStoreOnboardingFilesParams = (
  params: Record<string, unknown>
): FilesStoreOnboardingFilesParams => {
  const { cards } = params;
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error("invalid_onboarding_cards");
  }
  const parsed = cards.map((card) => {
    const { files, onboarding } = (card ?? {}) as Record<string, unknown>;
    if (
      typeof onboarding !== "string" ||
      onboarding.length === 0 ||
      onboarding.length > 100 ||
      !Array.isArray(files) ||
      files.length === 0
    ) {
      throw new Error("invalid_onboarding_cards");
    }
    return { files: files.map(parseFile), onboarding };
  });
  const keys = parsed.flatMap((card) => card.files.map((file) => file.key));
  if (
    keys.length > FILES_ONBOARDING_MAX_FILES ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error("invalid_onboarding_cards");
  }
  return { cards: parsed };
};

const readAsset = async (assets: Fetcher, source: string) => {
  const response = await assets.fetch(
    `${ASSET_ORIGIN}${FILES_ONBOARDING_ASSET_PATH}${source}`
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`onboarding_file_missing:${source}`);
  }
  return await response.arrayBuffer();
};

const storeCard = async (
  env: OnboardingFilesEnv & { ASSETS: Fetcher },
  card: FilesStoreOnboardingFilesParams["cards"][number]
): Promise<FilesOnboardingCardResult> => {
  const written: string[] = [];
  const settled = await Promise.allSettled(
    card.files.map(async (file) => {
      const bytes = await readAsset(env.ASSETS, file.source);
      await env.BUCKET.put(file.key, bytes, {
        httpMetadata: { contentType: file.contentType },
      });
      written.push(file.key);
      return { key: file.key, size: bytes.byteLength };
    })
  );
  const failure = settled.find((result) => result.status === "rejected");
  if (!failure) {
    return {
      files: settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      ),
      onboarding: card.onboarding,
      stored: true,
    };
  }
  // A card shows all of its files or none, so drop the ones that landed.
  if (written.length > 0) {
    try {
      await env.BUCKET.delete(written);
    } catch {
      // Convex registered every key first, so account deletion still finds
      // whatever stays.
    }
  }
  return {
    error:
      failure.reason instanceof Error
        ? failure.reason.message
        : String(failure.reason),
    onboarding: card.onboarding,
    stored: false,
  };
};

export const storeOnboardingFiles = async (
  env: OnboardingFilesEnv,
  params: FilesStoreOnboardingFilesParams
): Promise<FilesStoreOnboardingFilesResult> => {
  const assets = env.ASSETS;
  if (!assets) {
    throw new Error("onboarding_assets_missing");
  }
  return {
    cards: await Promise.all(
      params.cards.map((card) => storeCard({ ...env, ASSETS: assets }, card))
    ),
  };
};
