class ResponseSizeLimitError extends Error {}

const consumeResponseWithinLimit = async <T>(
  response: Response,
  maxBytes: number,
  consume: (boundedResponse: Response) => Promise<T>
): Promise<T | null> => {
  if (!(Number.isFinite(maxBytes) && maxBytes >= 0)) {
    throw new RangeError("maxBytes must be a non-negative finite number");
  }
  if (!response.body) {
    return consume(response);
  }

  let bytesRead = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) {
          throw new ResponseSizeLimitError();
        }
        controller.enqueue(chunk);
      },
    })
  );

  try {
    return await consume(
      new Response(boundedBody, {
        headers: response.headers,
      })
    );
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      return null;
    }
    throw error;
  }
};

export const readResponseBlobWithinLimit = (
  response: Response,
  maxBytes: number
): Promise<Blob | null> =>
  consumeResponseWithinLimit(response, maxBytes, (boundedResponse) =>
    boundedResponse.blob()
  );

export const readResponseTextWithinLimit = (
  response: Response,
  maxBytes: number
): Promise<string | null> =>
  consumeResponseWithinLimit(response, maxBytes, (boundedResponse) =>
    boundedResponse.text()
  );
