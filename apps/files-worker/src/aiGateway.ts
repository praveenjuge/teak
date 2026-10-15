/**
 * Every Workers AI call goes through AI Gateway when `AI_GATEWAY_ID` names a
 * gateway, so its analytics show requests, tokens, cost, latency and errors
 * per model. Prompts and replies hold private card content, so no request is
 * logged, and no reply is served from the gateway cache: refreshing a card
 * reruns the same prompt and must get a new answer.
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
  /** AI Gateway to route Workers AI calls through; unset calls Workers AI directly. */
  AI_GATEWAY_ID?: string;
}

/** The binding's third `run` argument, or undefined when no gateway is set. */
export const aiRunOptions = (
  env: AiGatewayEnv
): WorkersAiRunOptions | undefined => {
  const id = env.AI_GATEWAY_ID?.trim();
  return id
    ? { gateway: { collectLog: false, id, skipCache: true } }
    : undefined;
};
