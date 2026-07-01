import { LoginChooserPage } from "@/components/front-office/shell/login-chooser";

export default async function FrontOfficeLoginChooser({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginChooserPage nextPath={params.next ?? "/front-office"} />;
}
