/**
 * AI Gateway rejects streamed bodies ("AI Gateway does not support
 * ReadableStreams yet"), and Whisper streams the audio, so transcription
 * calls Workers AI directly.
 */

export interface WorkersAiRunOptions {
  gateway: {
    collectLog: false;
    id: string;
    skipCache: true;
  };
}

export interface WorkersAiBinding {
  run: (
    model: string,
    args: Record<string, unknown>,
    options?: WorkersAiRunOptions
  ) => Promise<unknown>;
}

export interface AiGatewayEnv {
  AI_GATEWAY_ID?: string;
}

export const aiRunOptions = (
  env: AiGatewayEnv
): WorkersAiRunOptions | undefined => {
  const id = env.AI_GATEWAY_ID?.trim();
  return id
    ? { gateway: { collectLog: false, id, skipCache: true } }
    : undefined;
};
