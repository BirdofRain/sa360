import { PortalPageSkeleton } from "@/components/client-portal/portal-page-skeleton";

export default function PortalNewOrderLoading() {
  return <PortalPageSkeleton label="Loading order request" cards={2} />;
}
