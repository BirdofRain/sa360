export function isInventoryCommerceExcluded(item: {
  commerceExcludedAt?: Date | string | null;
}): boolean {
  return item.commerceExcludedAt != null;
}
