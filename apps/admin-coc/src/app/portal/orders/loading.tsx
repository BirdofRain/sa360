import { PortalPageSkeleton } from "@/components/client-portal/portal-page-skeleton";

export default function PortalOrdersLoading() {
  return <PortalPageSkeleton label="Loading orders" cards={2} />;
}
