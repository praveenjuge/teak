// Cloudflare's Images binding accepts raw inputs up to 20 MB. The
// URL-transformation path takes larger sources: its remote-image limit covers
// Teak's upload ceiling.
export const IMAGES_BINDING_MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * Runs `use` on a stored image through the Images binding. Null sends the
 * caller to the URL-transformation path: no binding, a source over the
 * binding's limit, a missing object, or a binding failure.
 */
export const throughImagesBinding = async <T>(
  images: ImagesBinding | undefined,
  sourceSize: number,
  open: () => Promise<R2ObjectBody | null>,
  use: (images: ImagesBinding, object: R2ObjectBody) => Promise<T | null>
): Promise<T | null> => {
  if (!images || sourceSize > IMAGES_BINDING_MAX_INPUT_BYTES) {
    return null;
  }
  const object = await open();
  if (!object) {
    return null;
  }
  try {
    return await use(images, object);
  } catch {
    try {
      await object.body.cancel();
    } catch {}
    return null;
  }
};
