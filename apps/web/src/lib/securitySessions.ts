export interface DeviceSession {
  /** What the session's browser says; absent from older servers. */
  agent?: { browser?: string; kind: string; os?: string };
  current: boolean;
  id: string;
  lastActiveAt?: number;
  /** The server's English name, shown when `agent` is missing. */
  name: string;
  signedInAt: number;
}

export interface ConnectionTarget {
  consentId: string;
}
