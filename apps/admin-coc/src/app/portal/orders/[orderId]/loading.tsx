import { PortalPageSkeleton } from "@/components/client-portal/portal-page-skeleton";

export default function PortalOrderDetailLoading() {
  return <PortalPageSkeleton label="Loading order" cards={3} />;
}