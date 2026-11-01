import { internal } from "../../_generated/api";

interface Backend {
  mutation: (
    fn: typeof internal.admin.setSignupsPaused,
    args: { paused: boolean }
  ) => Promise<unknown>;
}

export const setSignupsPaused = (t: Backend, paused: boolean) =>
  t.mutation(internal.admin.setSignupsPaused, { paused });
