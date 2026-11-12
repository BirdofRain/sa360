export type AttentionRead =
  | { state: "ready"; count: number }
  | { state: "unavailable"; reason: string };
