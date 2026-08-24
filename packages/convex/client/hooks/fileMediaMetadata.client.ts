const getImageDimensions = (
  file: File
): Promise<{ height: number; width: number } | undefined> => {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    !file.type?.startsWith("image/")
  ) {
    return Promise.resolve(undefined);
  }
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      URL.revokeObjectURL(objectUrl);
      resolve(width && height ? { height, width } : undefined);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(undefined);
    };
    image.src = objectUrl;
  });
};

const getVideoDimensions = (
  file: File
): Promise<{ height: number; width: number } | undefined> => {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof document.createElement !== "function" ||
    !file.type?.startsWith("video/")
  ) {
    return Promise.resolve(undefined);
  }
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      resolve(width && height ? { height, width } : undefined);
    };
    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    video.src = objectUrl;
  });
};

export const buildAdditionalFileMetadata = async (
  file: File,
  metadata?: any
): Promise<any | undefined> => {
  if (metadata?.width && metadata?.height) {
    return metadata;
  }
  const dimensions =
    (await getImageDimensions(file)) ?? (await getVideoDimensions(file));
  return dimensions ? { ...dimensions, ...metadata } : metadata;
};
