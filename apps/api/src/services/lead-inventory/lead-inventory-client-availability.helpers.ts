export function bucketAvailabilityLabel(
  quantity: number
): "Available" | "Limited" | "Currently unavailable" {
  if (quantity <= 0) return "Currently unavailable";
  if (quantity < 5) return "Limited";
  return "Available";
}
