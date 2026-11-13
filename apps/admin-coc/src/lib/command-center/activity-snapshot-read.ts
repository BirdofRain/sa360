export type DeliveryFailureRead =
  | { state: "ready"; count: number; refreshedAt: string }
  | { state: "unavailable"; reason: string };
