import { SourceResolutionReview } from "@/components/facebook-intake/source-resolution-review";
import { loadFacebookSourceResolutionReview } from "@/lib/admin-api/facebook-intake-server";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function FacebookSourceResolutionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pageId = one(params.pageId);
  const formId = one(params.formId);
  const classification = one(params.classification);
  const offset = one(params.offset);
  const loaded = await loadFacebookSourceResolutionReview({ pageId, formId, classification, offset });
  return (
    <SourceResolutionReview
      review={loaded.review}
      error={loaded.error}
      pageId={pageId}
      formId={formId}
      classification={classification}
    />
  );
}
