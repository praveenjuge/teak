export interface FeedbackStatusPayload {
  accentColor?: string;
  dismissAfterMs?: number;
  iconName?: string;
  message: string;
  title?: string;
}

type Listener = (payload: FeedbackStatusPayload | null) => void;

let currentState: FeedbackStatusPayload | null = null;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of listeners) {
    listener(currentState);
  }
};

export function setFeedbackStatus(payload: FeedbackStatusPayload) {
  currentState = payload;
  notify();
}

export function clearFeedbackStatus() {
  currentState = null;
  notify();
}

export function subscribeFeedbackStatus(listener: Listener) {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export function getFeedbackStatus() {
  return currentState;
}
