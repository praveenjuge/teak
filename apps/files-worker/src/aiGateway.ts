/**
 * Text and image metadata calls go through AI Gateway when `AI_GATEWAY_ID`
 * names a gateway, so its analytics show requests, tokens, cost, latency and
 * errors per model. Prompts and replies hold private card content, so no
 * request is logged, and no reply is served from the gateway cache: refreshing
 * a card reruns the same prompt and must get a new answer.
 *
 * Whisper transcription calls Workers AI directly. It streams the audio body,
 * and AI Gateway rejects streams ("AI Gateway does not support ReadableStreams
 * yet"), so routing it through the gateway fails every transcript.
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
