import { FoPipelineStudioContent } from "@/components/front-office/pipeline-studio/fo-pipeline-studio-content";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getPipelineStudioReadModel } from "@/lib/front-office/pipeline-studio/get-pipeline-studio";
import "@/lib/front-office/pipeline-studio/tokens.css";

export default async function PipelineStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate
      pathname="/front-office/pipeline-studio"
      devRole={params.role}
    >
      {(session) => <PipelineStudioInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function PipelineStudioInner({
  session,
}: {
  session: NonNullable<
    Awaited<
      ReturnType<
        typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession
      >
    >
  >;
}) {
  const model = await getPipelineStudioReadModel();
  return (
    <FrontOfficeShell
      session={session}
      title="Lead Inventory Explorer"
      subtitle="Explore available lead inventory by niche, age, state, and timezone."
      dataSource={model.dataSource}
    >
      <FoPipelineStudioContent model={model} />
    </FrontOfficeShell>
  );
}
